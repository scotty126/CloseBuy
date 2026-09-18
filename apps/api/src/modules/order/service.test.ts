import { describe, it, expect, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { checkoutSchema } from "@closebuy/types";
import {
  createOrderService,
  VendorUnavailableError,
  OutsideServiceAreaError,
  CartInvalidError,
  InvalidOrderStateError,
  InvalidCollectionCodeError,
  VendorProfileNotFoundError,
} from "./service.js";
import type { MonnifyClient } from "../payments/monnify.js";
import type { OrderQueue } from "./jobs.js";
import type { NotificationService } from "../notifications/service.js";

/**
 * In-memory fake Prisma — covers exactly the operations the order service
 * uses, including `$transaction` (runs the callback against the same
 * fake, no real isolation needed for these tests) and the atomic
 * conditional `updateMany` the stock decrement depends on.
 */
function createFakePrisma() {
  const vendors = new Map<string, any>();
  const products = new Map<string, any>();
  const customers = new Map<string, any>();
  const riders = new Map<string, any>();
  const orders = new Map<string, any>();
  const orderItems: any[] = [];
  const transitions: any[] = [];
  const payments = new Map<string, any>();
  const ledgerEntries: any[] = [];
  const payouts: any[] = [];
  const disputes = new Map<string, any>();
  // Same defaults as prisma/seed.ts — the order service reads these
  // through lib/config.ts exactly the way it would read real seeded rows.
  const config = new Map<string, any>([
    ["commission_rate.pickup", 5],
    ["commission_rate.delivery", 10],
    ["vendor_accept_window_minutes", 15],
    ["escrow_release_window_hours", 48],
    ["flat_delivery_fee_minor", 50000],
    // Simple 0-10/0-10 test square, standing in for the real Riverpark
    // polygon (prisma/seed.ts) — geometry itself is tested in lib/geo.test.ts.
    [
      "service_area_polygon",
      [
        { lat: 0, lng: 0 },
        { lat: 0, lng: 10 },
        { lat: 10, lng: 10 },
        { lat: 10, lng: 0 },
      ],
    ],
  ]);
  let nextId = 1;
  const id = () => `id_${nextId++}`;

  const db = {
    vendorProfile: {
      findUnique: async ({ where }: any) =>
        where.id ? (vendors.get(where.id) ?? null) : [...vendors.values()].find((v) => v.userId === where.userId) ?? null,
      update: async ({ where, data }: any) => {
        const v = vendors.get(where.id);
        const updated = { ...v, ...applyOps(v, data) };
        vendors.set(where.id, updated);
        return updated;
      },
    },
    customerProfile: {
      findUnique: async ({ where }: any) =>
        where.id ? (customers.get(where.id) ?? null) : [...customers.values()].find((c) => c.userId === where.userId) ?? null,
    },
    riderProfile: {
      findUnique: async ({ where }: any) =>
        where.id ? (riders.get(where.id) ?? null) : [...riders.values()].find((r) => r.userId === where.userId) ?? null,
    },
    product: {
      findMany: async ({ where }: any) => [...products.values()].filter((p) => where.id.in.includes(p.id)),
      findUnique: async ({ where }: any) => products.get(where.id) ?? null,
      updateMany: async ({ where, data }: any) => {
        const p = products.get(where.id);
        if (!p || p.stock < where.stock.gte) return { count: 0 };
        products.set(where.id, { ...p, stock: p.stock - data.stock.decrement });
        return { count: 1 };
      },
    },
    order: {
      create: async ({ data }: any) => {
        const order = { id: id(), trackingToken: id(), collectionCode: null, ...data };
        delete order.items;
        orders.set(order.id, order);
        for (const item of data.items?.create ?? []) orderItems.push({ id: id(), orderId: order.id, ...item });
        return order;
      },
      findUnique: async ({ where }: any) =>
        where.id ? (orders.get(where.id) ?? null) : [...orders.values()].find((o) => o.trackingToken === where.trackingToken) ?? null,
      findUniqueOrThrow: async ({ where }: any) => {
        const o = orders.get(where.id);
        if (!o) throw new Error("not found");
        return o;
      },
      update: async ({ where, data }: any) => {
        const o = orders.get(where.id);
        const updated = { ...o, ...applyOps(o, data) };
        orders.set(where.id, updated);
        return updated;
      },
      findMany: async ({ where }: any) =>
        [...orders.values()].filter((o) => {
          if (where.customerId !== undefined && o.customerId !== where.customerId) return false;
          if (where.vendorId !== undefined && o.vendorId !== where.vendorId) return false;
          return true;
        }),
    },
    orderItem: {
      findMany: async ({ where }: any) => orderItems.filter((i) => i.orderId === where.orderId),
    },
    orderStateTransition: {
      create: async ({ data }: any) => {
        const t = { id: id(), createdAt: new Date(), ...data };
        transitions.push(t);
        return t;
      },
      findFirst: async ({ where }: any) => transitions.find((t) => t.orderId === where.orderId && t.toStatus === where.toStatus) ?? null,
    },
    payment: {
      create: async ({ data }: any) => {
        const p = { id: id(), ...data };
        payments.set(p.gatewayReference, p);
        return p;
      },
      findUnique: async ({ where }: any) =>
        where.gatewayReference
          ? (payments.get(where.gatewayReference) ?? null)
          : [...payments.values()].find((p) => p.orderId === where.orderId) ?? null,
      update: async ({ where, data }: any) => {
        const p = [...payments.values()].find((x) => x.id === where.id)!;
        const updated = { ...p, ...data };
        payments.set(p.gatewayReference, updated);
        return updated;
      },
    },
    ledgerEntry: {
      createMany: async ({ data }: any) => {
        ledgerEntries.push(...data);
        return { count: data.length };
      },
      // getVendorEarnings folds in computeVendorBalance (payouts/balance.ts)
      // now, so this fake needs to answer that query shape too.
      aggregate: async ({ where }: any) => ({
        _sum: {
          amountMinor: ledgerEntries
            .filter((e) => e.account === where.account && e.direction === where.direction && orders.get(e.orderId)?.vendorId === where.order.vendorId)
            .reduce((s, e) => s + e.amountMinor, 0),
        },
      }),
    },
    payout: {
      aggregate: async ({ where }: any) => ({
        _sum: {
          amountMinor: payouts
            .filter((p: any) => p.payeeType === where.payeeType && p.payeeId === where.payeeId && where.status.in.includes(p.status))
            .reduce((s: number, p: any) => s + p.amountMinor, 0),
        },
      }),
    },
    dispute: {
      create: async ({ data }: any) => {
        const d = { id: id(), status: "open", createdAt: new Date(), ...data };
        disputes.set(d.orderId, d);
        return d;
      },
      findUnique: async ({ where }: any) => disputes.get(where.orderId) ?? null,
    },
    rating: {
      create: async ({ data }: any) => ({ id: id(), createdAt: new Date(), ...data }),
    },
    config: {
      findFirst: async ({ where }: any) => (config.has(where.key) ? { key: where.key, value: config.get(where.key) } : null),
    },
    $transaction: async (fn: any) => fn(db),
    // Exposed for assertions, not part of the real Prisma surface.
    __state: { vendors, products, customers, riders, orders, orderItems, transitions, payments, ledgerEntries, payouts, disputes },
  };

  function applyOps(existing: any, data: any) {
    const out: any = {};
    for (const [k, v] of Object.entries(data)) {
      if (v && typeof v === "object" && "decrement" in (v as any)) out[k] = existing[k] - (v as any).decrement;
      else out[k] = v;
    }
    return out;
  }

  return db as unknown as PrismaClient & { __state: typeof db.__state };
}

function createFakeMonnify(overrides?: Partial<MonnifyClient>): MonnifyClient {
  return {
    initializeTransaction: vi.fn().mockResolvedValue({ checkoutUrl: "https://sandbox.monnify.com/pay/abc", transactionReference: "txn_1" }),
    verifyWebhookSignature: vi.fn().mockReturnValue(true),
    refund: vi.fn().mockResolvedValue(undefined),
    transfer: vi.fn().mockResolvedValue({ status: "SUCCESS", providerReference: "transfer_1" }),
    ...overrides,
  };
}

function createFakeQueue(): OrderQueue {
  return {
    scheduleAutoReject: vi.fn().mockResolvedValue(undefined),
    scheduleEscrowRelease: vi.fn().mockResolvedValue(undefined),
    cancelAutoReject: vi.fn().mockResolvedValue(undefined),
    cancelEscrowRelease: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function createFakeNotifications(): NotificationService {
  return { notify: vi.fn().mockResolvedValue(undefined) } as unknown as NotificationService;
}

const VENDOR_ID = "vendor_1";
const VENDOR_USER_ID = "vendor_user_1";
const PRODUCT_ID = "product_1";
const CUSTOMER_ID = "customer_1";
const CUSTOMER_USER_ID = "customer_user_1";
const RIDER_ID = "rider_1";
const RIDER_USER_ID = "rider_user_1";

function seed(prisma: ReturnType<typeof createFakePrisma>, overrides?: { vendor?: any; product?: any }) {
  prisma.__state.vendors.set(VENDOR_ID, {
    id: VENDOR_ID,
    userId: VENDOR_USER_ID,
    status: "approved",
    isOpen: true,
    supportsPickup: true,
    reliabilityScore: 5,
    ...overrides?.vendor,
  });
  prisma.__state.products.set(PRODUCT_ID, {
    id: PRODUCT_ID,
    vendorId: VENDOR_ID,
    name: "Jollof rice",
    priceMinor: 250000,
    stock: 10,
    isActive: true,
    ...overrides?.product,
  });
}

describe("order service — checkout (US-C-06)", () => {
  let prisma: ReturnType<typeof createFakePrisma>;
  let monnify: MonnifyClient;
  let queue: OrderQueue;
  let notifications: NotificationService;

  beforeEach(() => {
    prisma = createFakePrisma();
    monnify = createFakeMonnify();
    queue = createFakeQueue();
    notifications = createFakeNotifications();
    seed(prisma);
  });

  function service() {
    return createOrderService({ prisma, monnify, queue, notifications, customerAppUrl: "http://localhost:3000" });
  }

  const baseInput = () => ({
    vendorId: VENDOR_ID,
    items: [{ productId: PRODUCT_ID, quantity: 2 }],
    fulfilmentType: "pickup" as const,
    paymentMethod: "cash_on_delivery" as const,
    contactPhone: "+2348012345678",
  });

  it("guest checkout: no session required at all", async () => {
    const result = await service().checkout(baseInput(), null, "idem-1");
    expect(result.order.status).toBe("PAID"); // COD skips the gateway entirely
    expect(result.order.customerId).toBeUndefined();
  });

  it("still completes checkout as PAID when scheduling the auto-reject timer fails (bad Redis)", async () => {
    queue.scheduleAutoReject = vi.fn().mockRejectedValue(new Error("redis down"));
    const result = await service().checkout(baseInput(), null, "idem-1b");
    expect(result.order.status).toBe("PAID");
  });

  it("computes the total server-side from the DB price, never trusting a client-submitted price", async () => {
    const result = await service().checkout(baseInput(), null, "idem-2");
    expect(result.order.subtotalMinor).toBe(500000); // 2 x 250000, not whatever a client might have sent
    expect(result.order.deliveryFeeMinor).toBe(0); // pickup
  });

  it("rejects checkout against a vendor that isn't approved", async () => {
    seed(prisma, { vendor: { status: "pending" } });
    await expect(service().checkout(baseInput(), null, "idem-3")).rejects.toThrow(VendorUnavailableError);
  });

  it("rejects checkout when the vendor is closed and the order isn't scheduled", async () => {
    seed(prisma, { vendor: { isOpen: false } });
    await expect(service().checkout(baseInput(), null, "idem-4")).rejects.toThrow(VendorUnavailableError);
  });

  it("accepts a delivery order whose address falls inside the service area", async () => {
    const input = { ...baseInput(), fulfilmentType: "delivery" as const, deliveryLat: 5, deliveryLng: 5, deliveryLandmark: "Blue gate" };
    const result = await service().checkout(input, null, "idem-area-1");
    expect(result.order.status).toBe("PAID");
  });

  it("rejects a delivery order whose address falls outside the service area (brief §2a — Riverpark only)", async () => {
    const input = { ...baseInput(), fulfilmentType: "delivery" as const, deliveryLat: 55, deliveryLng: 55, deliveryLandmark: "Somewhere else entirely" };
    await expect(service().checkout(input, null, "idem-area-2")).rejects.toThrow(OutsideServiceAreaError);
  });

  it("rejects checkout for more items than are in stock", async () => {
    const result = service().checkout({ ...baseInput(), items: [{ productId: PRODUCT_ID, quantity: 999 }] }, null, "idem-5");
    await expect(result).rejects.toThrow(CartInvalidError);
  });

  it("rejects checkout for a product that belongs to a different vendor than the cart claims", async () => {
    prisma.__state.products.set("other_product", { id: "other_product", vendorId: "some_other_vendor", name: "Not this vendor's", priceMinor: 1000, stock: 5, isActive: true });
    const result = service().checkout({ ...baseInput(), items: [{ productId: "other_product", quantity: 1 }] }, null, "idem-6");
    await expect(result).rejects.toThrow(CartInvalidError);
  });

  it("is idempotent: the same Idempotency-Key returns the same order instead of creating a second one", async () => {
    const first = await service().checkout(baseInput(), null, "idem-7");
    const second = await service().checkout(baseInput(), null, "idem-7");

    expect(second.order.id).toBe(first.order.id);
    expect(prisma.__state.orders.size).toBe(1);
  });

  it("card payment initiates a Monnify transaction and leaves the order PENDING_PAYMENT until the webhook confirms", async () => {
    const result = await service().checkout({ ...baseInput(), paymentMethod: "card" as const }, null, "idem-8");

    expect(monnify.initializeTransaction).toHaveBeenCalledOnce();
    expect((result as any).checkoutUrl).toBeDefined();
    expect(result.order.status).toBe("PENDING_PAYMENT");
  });

  it("cash on delivery is rejected for a pickup order at the schema level (brief §3.1a — no delivery to pay on)", () => {
    // Schema-level check, not something the service itself needs to guard —
    // an invalid combination never reaches checkout() at all.
    expect(() => checkoutSchema.parse({ ...baseInput(), fulfilmentType: "pickup", paymentMethod: "cash_on_delivery" })).toThrow();
  });

  it("notifies the vendor once an order is paid (architecture.md: push fires from the module that made the transition)", async () => {
    await service().checkout(baseInput(), null, "idem-notify-1"); // COD — PAID happens synchronously inside checkout
    expect(notifications.notify).toHaveBeenCalledWith(VENDOR_USER_ID, "order_paid", expect.objectContaining({ totalMinor: 500000 }));
  });
});

describe("order service — vendor actions (US-V-05/06)", () => {
  let prisma: ReturnType<typeof createFakePrisma>;
  let monnify: MonnifyClient;
  let queue: OrderQueue;
  let notifications: NotificationService;

  beforeEach(() => {
    prisma = createFakePrisma();
    monnify = createFakeMonnify();
    queue = createFakeQueue();
    notifications = createFakeNotifications();
    seed(prisma);
    prisma.__state.customers.set(CUSTOMER_ID, { id: CUSTOMER_ID, userId: CUSTOMER_USER_ID });
  });

  function service() {
    return createOrderService({ prisma, monnify, queue, notifications, customerAppUrl: "http://localhost:3000" });
  }

  async function checkedOutOrder(auth: { sub: string; role: string } | null = null) {
    const svc = service();
    const { order } = await svc.checkout(
      { vendorId: VENDOR_ID, items: [{ productId: PRODUCT_ID, quantity: 2 }], fulfilmentType: "pickup", paymentMethod: "cash_on_delivery", contactPhone: "+2348012345678" },
      auth,
      `idem-${Math.random()}`,
    );
    return { svc, order };
  }

  it("accept: decrements stock atomically and transitions to PREPARING", async () => {
    const { svc, order } = await checkedOutOrder();
    await svc.acceptOrder(VENDOR_USER_ID, order.id);

    expect(prisma.__state.orders.get(order.id).status).toBe("PREPARING");
    expect(prisma.__state.products.get(PRODUCT_ID).stock).toBe(8); // 10 - 2
    expect(queue.cancelAutoReject).toHaveBeenCalledWith(order.id);
  });

  it("accept: fails if stock ran out between checkout and accept, and does not partially decrement", async () => {
    const { svc, order } = await checkedOutOrder();
    prisma.__state.products.set(PRODUCT_ID, { ...prisma.__state.products.get(PRODUCT_ID), stock: 1 }); // dropped below the order's 2

    await expect(svc.acceptOrder(VENDOR_USER_ID, order.id)).rejects.toThrow(InvalidOrderStateError);
    expect(prisma.__state.orders.get(order.id).status).toBe("PAID"); // unchanged — never left in a half-accepted state
  });

  it("accept: rejects an order that isn't PAID (already accepted, or never existed in that state)", async () => {
    const { svc, order } = await checkedOutOrder();
    await svc.acceptOrder(VENDOR_USER_ID, order.id);

    await expect(svc.acceptOrder(VENDOR_USER_ID, order.id)).rejects.toThrow(InvalidOrderStateError);
  });

  it("reject: cash-on-delivery orders need no refund (nothing was ever charged)", async () => {
    const { svc, order } = await checkedOutOrder();
    await svc.rejectOrder(VENDOR_USER_ID, order.id, { reason: "Out of ingredients" });

    expect(prisma.__state.orders.get(order.id).status).toBe("REFUNDED"); // ledger-wise a no-op, but the state machine still completes the same path
    expect(monnify.refund).not.toHaveBeenCalled();
  });

  it("reject: a card-paid order does get refunded through Monnify", async () => {
    const svc = service();
    const { order } = await svc.checkout(
      { vendorId: VENDOR_ID, items: [{ productId: PRODUCT_ID, quantity: 1 }], fulfilmentType: "pickup", paymentMethod: "card", contactPhone: "+2348012345678" },
      null,
      "idem-card-1",
    );
    // Simulate the webhook having confirmed payment.
    await svc.handleMonnifyWebhook({
      eventType: "SUCCESSFUL_TRANSACTION",
      eventData: { paymentReference: "idem-card-1", transactionReference: "txn_1", amountPaid: 2500, paymentStatus: "PAID" },
    });

    await svc.rejectOrder(VENDOR_USER_ID, order.id, { reason: "Closed early" });
    expect(monnify.refund).toHaveBeenCalledOnce();
  });

  it("ready then confirmCustomerPickup: wrong code is rejected, right code completes the order and schedules escrow release", async () => {
    const { svc, order } = await checkedOutOrder();
    await svc.acceptOrder(VENDOR_USER_ID, order.id);
    await svc.markReady(VENDOR_USER_ID, order.id);

    const withCode = prisma.__state.orders.get(order.id);
    expect(withCode.collectionCode).toMatch(/^\d{6}$/);

    await expect(svc.confirmCustomerPickup(VENDOR_USER_ID, order.id, { code: "000000" })).rejects.toThrow(InvalidCollectionCodeError);

    await svc.confirmCustomerPickup(VENDOR_USER_ID, order.id, { code: withCode.collectionCode });
    expect(prisma.__state.orders.get(order.id).status).toBe("DELIVERED");
    expect(queue.scheduleEscrowRelease).toHaveBeenCalledWith(order.id, expect.any(Number));
  });

  it("still completes confirmCustomerPickup as DELIVERED when scheduling escrow release fails (bad Redis)", async () => {
    const { svc, order } = await checkedOutOrder();
    await svc.acceptOrder(VENDOR_USER_ID, order.id);
    await svc.markReady(VENDOR_USER_ID, order.id);
    const { collectionCode } = prisma.__state.orders.get(order.id);

    queue.scheduleEscrowRelease = vi.fn().mockRejectedValue(new Error("redis down"));
    await svc.confirmCustomerPickup(VENDOR_USER_ID, order.id, { code: collectionCode });

    expect(prisma.__state.orders.get(order.id).status).toBe("DELIVERED");
  });

  it("notifies a signed-in customer on accept, reject and ready — never a guest order, which has no account to notify", async () => {
    const { svc, order } = await checkedOutOrder({ sub: CUSTOMER_USER_ID, role: "customer" });
    await svc.acceptOrder(VENDOR_USER_ID, order.id);
    expect(notifications.notify).toHaveBeenCalledWith(CUSTOMER_USER_ID, "order_accepted", { orderId: order.id });

    await svc.markReady(VENDOR_USER_ID, order.id);
    const { collectionCode } = prisma.__state.orders.get(order.id);
    expect(notifications.notify).toHaveBeenCalledWith(CUSTOMER_USER_ID, "order_ready_for_pickup", { orderId: order.id, collectionCode });

    (notifications.notify as any).mockClear();
    const { order: guestOrder } = await checkedOutOrder(null);
    await svc.acceptOrder(VENDOR_USER_ID, guestOrder.id);
    // The vendor still gets "order_paid" from checkout itself — only the
    // customer-facing "order_accepted" is skipped, since a guest order has
    // no User row behind it to notify (brief §3.1b).
    expect(notifications.notify).not.toHaveBeenCalledWith(expect.anything(), "order_accepted", expect.anything());
  });

  it("notifies the customer on reject, with the vendor's reason", async () => {
    const { svc, order } = await checkedOutOrder({ sub: CUSTOMER_USER_ID, role: "customer" });
    await svc.rejectOrder(VENDOR_USER_ID, order.id, { reason: "Out of ingredients" });
    expect(notifications.notify).toHaveBeenCalledWith(CUSTOMER_USER_ID, "order_rejected", { orderId: order.id, reason: "Out of ingredients" });
  });

  it("listVendorOrders: only this vendor's own orders, never another vendor's (screens-navigation.md §2.1)", async () => {
    const { svc, order } = await checkedOutOrder();
    prisma.__state.vendors.set("vendor_other", { id: "vendor_other", userId: "vendor_user_other", status: "approved", isOpen: true });
    prisma.__state.orders.set("order_other_vendor", { id: "order_other_vendor", vendorId: "vendor_other", status: "PAID", createdAt: new Date() });

    const orders = await svc.listVendorOrders(VENDOR_USER_ID);
    expect(orders.map((o: any) => o.id)).toEqual([order.id]);
  });

  it("listVendorOrders: throws for an account with no vendor profile", async () => {
    await expect(service().listVendorOrders("nobody")).rejects.toThrow(VendorProfileNotFoundError);
  });

  it("getVendorEarnings: a vendor is paid the goods total minus commission, never the delivery fee (brief §3.2a)", async () => {
    const svc = service();
    prisma.__state.orders.set("order_cleared", {
      id: "order_cleared", vendorId: VENDOR_ID, status: "COMPLETED",
      subtotalMinor: 500000, commissionMinor: 25000, deliveryFeeMinor: 50000, updatedAt: new Date(),
    });
    prisma.__state.orders.set("order_in_flight", {
      id: "order_in_flight", vendorId: VENDOR_ID, status: "PREPARING",
      subtotalMinor: 300000, commissionMinor: 0, deliveryFeeMinor: 50000, updatedAt: new Date(),
    });

    const earnings = await svc.getVendorEarnings(VENDOR_USER_ID);
    expect(earnings.clearedMinor).toBe(475000); // 500000 - 25000 commission, delivery fee excluded either way
    expect(earnings.pendingMinor).toBe(300000); // gross estimate — commission isn't final until COMPLETED
    expect(earnings.orders).toHaveLength(1);
    expect(earnings.orders[0]).toMatchObject({ orderId: "order_cleared", grossMinor: 500000, commissionMinor: 25000, netMinor: 475000 });
  });

  it("getVendorEarnings: throws for an account with no vendor profile", async () => {
    await expect(service().getVendorEarnings("nobody")).rejects.toThrow(VendorProfileNotFoundError);
  });

  it("getVendorEarnings: availableToWithdrawMinor is clearedMinor net of a payout already made — a genuinely different number, not a copy of it", async () => {
    const svc = service();
    prisma.__state.orders.set("order_cleared", {
      id: "order_cleared", vendorId: VENDOR_ID, status: "COMPLETED",
      subtotalMinor: 500000, commissionMinor: 25000, deliveryFeeMinor: 50000, updatedAt: new Date(),
    });
    // escrowReleaseEntries' real shape (order/ledger.ts) — vendor_payable credited net of commission.
    prisma.__state.ledgerEntries.push({ orderId: "order_cleared", account: "vendor_payable", direction: "credit", amountMinor: 475000 });
    prisma.__state.payouts.push({ payeeType: "vendor", payeeId: VENDOR_ID, status: "paid", amountMinor: 200000 });

    const earnings = await svc.getVendorEarnings(VENDOR_USER_ID);
    expect(earnings.clearedMinor).toBe(475000);
    expect(earnings.availableToWithdrawMinor).toBe(275000);
    expect(earnings.availableToWithdrawMinor).toBeLessThan(earnings.clearedMinor);
  });

  it("markReady: generates a deliveryCode for delivery orders, never for pickup (US-R-05's second handoff check)", async () => {
    const svc = service();

    const { order: pickupOrder } = await checkedOutOrder(); // defaults to pickup
    await svc.acceptOrder(VENDOR_USER_ID, pickupOrder.id);
    await svc.markReady(VENDOR_USER_ID, pickupOrder.id);
    const storedPickup = prisma.__state.orders.get(pickupOrder.id);
    expect(storedPickup.collectionCode).toMatch(/^\d{6}$/);
    expect(storedPickup.deliveryCode).toBeNull();

    const { order: deliveryOrder } = await svc.checkout(
      {
        vendorId: VENDOR_ID,
        items: [{ productId: PRODUCT_ID, quantity: 1 }],
        fulfilmentType: "delivery",
        paymentMethod: "cash_on_delivery",
        contactPhone: "+2348012345678",
        deliveryLat: 5,
        deliveryLng: 5,
        deliveryLandmark: "Blue gate",
      },
      null,
      `idem-${Math.random()}`,
    );
    await svc.acceptOrder(VENDOR_USER_ID, deliveryOrder.id);
    await svc.markReady(VENDOR_USER_ID, deliveryOrder.id);
    const storedDelivery = prisma.__state.orders.get(deliveryOrder.id);
    expect(storedDelivery.collectionCode).toMatch(/^\d{6}$/);
    expect(storedDelivery.deliveryCode).toMatch(/^\d{6}$/);
    expect(storedDelivery.deliveryCode).not.toBe(storedDelivery.collectionCode);
  });

  it("getOrder redacts collectionCode/deliveryCode by role — customer sees both, vendor keeps only collectionCode, rider sees neither", async () => {
    const svc = service();
    prisma.__state.riders.set(RIDER_ID, { id: RIDER_ID, userId: RIDER_USER_ID });

    const { order } = await svc.checkout(
      {
        vendorId: VENDOR_ID,
        items: [{ productId: PRODUCT_ID, quantity: 1 }],
        fulfilmentType: "delivery",
        paymentMethod: "cash_on_delivery",
        contactPhone: "+2348012345678",
        deliveryLat: 5,
        deliveryLng: 5,
        deliveryLandmark: "Blue gate",
      },
      { sub: CUSTOMER_USER_ID, role: "customer" },
      `idem-${Math.random()}`,
    );
    await svc.acceptOrder(VENDOR_USER_ID, order.id);
    await svc.markReady(VENDOR_USER_ID, order.id);
    prisma.__state.orders.set(order.id, { ...prisma.__state.orders.get(order.id), riderId: RIDER_ID });

    const asCustomer = await svc.getOrder(order.id, { sub: CUSTOMER_USER_ID, role: "customer" });
    expect((asCustomer as any).collectionCode).toEqual(expect.any(String));
    expect((asCustomer as any).deliveryCode).toEqual(expect.any(String));

    const asVendor = await svc.getOrder(order.id, { sub: VENDOR_USER_ID, role: "vendor" });
    expect((asVendor as any).collectionCode).toEqual(expect.any(String));
    expect(asVendor).not.toHaveProperty("deliveryCode");

    const asRider = await svc.getOrder(order.id, { sub: RIDER_USER_ID, role: "rider" });
    expect(asRider).not.toHaveProperty("collectionCode");
    expect(asRider).not.toHaveProperty("deliveryCode");
  });

  it("listVendorOrders never includes deliveryCode — that handoff doesn't involve the vendor", async () => {
    const svc = service();
    const { order } = await svc.checkout(
      {
        vendorId: VENDOR_ID,
        items: [{ productId: PRODUCT_ID, quantity: 1 }],
        fulfilmentType: "delivery",
        paymentMethod: "cash_on_delivery",
        contactPhone: "+2348012345678",
        deliveryLat: 5,
        deliveryLng: 5,
        deliveryLandmark: "Blue gate",
      },
      null,
      `idem-${Math.random()}`,
    );
    await svc.acceptOrder(VENDOR_USER_ID, order.id);
    await svc.markReady(VENDOR_USER_ID, order.id);

    const orders = await svc.listVendorOrders(VENDOR_USER_ID);
    expect(orders[0]!.collectionCode).toEqual(expect.any(String));
    expect(orders[0]).not.toHaveProperty("deliveryCode");
  });
});

describe("order service — timers (US-V-05 auto-reject, brief §4 escrow release)", () => {
  let prisma: ReturnType<typeof createFakePrisma>;
  let monnify: MonnifyClient;
  let queue: OrderQueue;
  let notifications: NotificationService;

  beforeEach(() => {
    prisma = createFakePrisma();
    monnify = createFakeMonnify();
    queue = createFakeQueue();
    notifications = createFakeNotifications();
    seed(prisma);
  });

  function service() {
    return createOrderService({ prisma, monnify, queue, notifications, customerAppUrl: "http://localhost:3000" });
  }

  it("autoRejectOrder: no-ops if a human already acted (order no longer PAID) — never double-processes", async () => {
    const svc = service();
    const { order } = await svc.checkout(
      { vendorId: VENDOR_ID, items: [{ productId: PRODUCT_ID, quantity: 1 }], fulfilmentType: "pickup", paymentMethod: "cash_on_delivery", contactPhone: "+2348012345678" },
      null,
      "idem-timer-1",
    );
    await svc.acceptOrder(VENDOR_USER_ID, order.id); // vendor got there first

    await svc.autoRejectOrder(order.id);
    expect(prisma.__state.orders.get(order.id).status).toBe("PREPARING"); // untouched by the stale timer
  });

  it("releaseEscrow: no-ops if a dispute was opened in the meantime", async () => {
    const svc = service();
    const { order } = await svc.checkout(
      { vendorId: VENDOR_ID, items: [{ productId: PRODUCT_ID, quantity: 1 }], fulfilmentType: "pickup", paymentMethod: "cash_on_delivery", contactPhone: "+2348012345678" },
      null,
      "idem-timer-2",
    );
    await svc.acceptOrder(VENDOR_USER_ID, order.id);
    await svc.markReady(VENDOR_USER_ID, order.id);
    const code = prisma.__state.orders.get(order.id).collectionCode;
    await svc.confirmCustomerPickup(VENDOR_USER_ID, order.id, { code });

    prisma.__state.disputes.set(order.id, { orderId: order.id, status: "open" });

    await svc.releaseEscrow(order.id);
    expect(prisma.__state.orders.get(order.id).status).toBe("DELIVERED"); // still held, not COMPLETED
  });
});
