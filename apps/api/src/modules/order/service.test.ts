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
} from "./service.js";
import type { MonnifyClient } from "../payments/monnify.js";
import type { OrderQueue } from "./jobs.js";

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
  const orders = new Map<string, any>();
  const orderItems: any[] = [];
  const transitions: any[] = [];
  const payments = new Map<string, any>();
  const ledgerEntries: any[] = [];
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
      findUnique: async ({ where }: any) => customers.get(where.userId) ?? null,
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
      findMany: async ({ where }: any) => [...orders.values()].filter((o) => o.customerId === where.customerId),
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
    __state: { vendors, products, customers, orders, orderItems, transitions, payments, ledgerEntries, disputes },
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

const VENDOR_ID = "vendor_1";
const VENDOR_USER_ID = "vendor_user_1";
const PRODUCT_ID = "product_1";

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

  beforeEach(() => {
    prisma = createFakePrisma();
    monnify = createFakeMonnify();
    queue = createFakeQueue();
    seed(prisma);
  });

  function service() {
    return createOrderService({ prisma, monnify, queue, customerAppUrl: "http://localhost:3000" });
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
});

describe("order service — vendor actions (US-V-05/06)", () => {
  let prisma: ReturnType<typeof createFakePrisma>;
  let monnify: MonnifyClient;
  let queue: OrderQueue;

  beforeEach(() => {
    prisma = createFakePrisma();
    monnify = createFakeMonnify();
    queue = createFakeQueue();
    seed(prisma);
  });

  function service() {
    return createOrderService({ prisma, monnify, queue, customerAppUrl: "http://localhost:3000" });
  }

  async function checkedOutOrder() {
    const svc = service();
    const { order } = await svc.checkout(
      { vendorId: VENDOR_ID, items: [{ productId: PRODUCT_ID, quantity: 2 }], fulfilmentType: "pickup", paymentMethod: "cash_on_delivery", contactPhone: "+2348012345678" },
      null,
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
});

describe("order service — timers (US-V-05 auto-reject, brief §4 escrow release)", () => {
  let prisma: ReturnType<typeof createFakePrisma>;
  let monnify: MonnifyClient;
  let queue: OrderQueue;

  beforeEach(() => {
    prisma = createFakePrisma();
    monnify = createFakeMonnify();
    queue = createFakeQueue();
    seed(prisma);
  });

  function service() {
    return createOrderService({ prisma, monnify, queue, customerAppUrl: "http://localhost:3000" });
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
