import { describe, it, expect, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  createAdminOrderService,
  OrderNotFoundError,
  InvalidOrderStateError,
  NoRiderAssignedError,
  NothingToRefundError,
} from "./orders.js";
import type { MonnifyClient } from "../payments/monnify.js";
import type { NotificationService } from "../notifications/service.js";

/** In-memory fake Prisma — covers exactly what admin/orders.ts touches, including the relation joins its `include` clauses ask for. */
function createFakePrisma() {
  const orders = new Map<string, any>();
  const vendors = new Map<string, any>();
  const riders = new Map<string, any>();
  const customers = new Map<string, any>();
  const items: any[] = [];
  const transitions: any[] = [];
  const payments = new Map<string, any>(); // keyed by orderId
  const ledgerEntries: any[] = [];
  const auditLog: any[] = [];
  let nextId = 1;
  const id = () => `id_${nextId++}`;

  const db = {
    order: {
      findUnique: async ({ where, include }: any) => {
        const o = orders.get(where.id);
        if (!o) return null;
        return include ? withRelations(o, include) : o;
      },
      findUniqueOrThrow: async ({ where }: any) => {
        const o = orders.get(where.id);
        if (!o) throw new Error("not found");
        return o;
      },
      update: async ({ where, data }: any) => {
        const updated = { ...orders.get(where.id), ...data };
        orders.set(where.id, updated);
        return updated;
      },
      findMany: async ({ where, take, cursor, skip, include }: any) => {
        let list = [...orders.values()]
          .filter((o) => {
            if (where.status !== undefined && o.status !== where.status) return false;
            if (where.vendorId !== undefined && o.vendorId !== where.vendorId) return false;
            if (where.riderId !== undefined && o.riderId !== where.riderId) return false;
            if (where.fulfilmentType !== undefined && o.fulfilmentType !== where.fulfilmentType) return false;
            return true;
          })
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        if (cursor) {
          const idx = list.findIndex((o) => o.id === cursor.id);
          list = list.slice(idx + (skip ?? 0));
        }
        if (take) list = list.slice(0, take);
        return include ? list.map((o) => withRelations(o, include)) : list;
      },
    },
    orderStateTransition: {
      create: async ({ data }: any) => {
        const t = { id: id(), createdAt: new Date(), ...data };
        transitions.push(t);
        return t;
      },
    },
    payment: {
      findUnique: async ({ where }: any) => payments.get(where.orderId) ?? null,
      update: async ({ where, data }: any) => {
        const p = [...payments.values()].find((x) => x.id === where.id)!;
        const updated = { ...p, ...data };
        payments.set(p.orderId, updated);
        return updated;
      },
    },
    ledgerEntry: {
      createMany: async ({ data }: any) => {
        ledgerEntries.push(...data);
        return { count: data.length };
      },
    },
    vendorProfile: { findUnique: async ({ where }: any) => vendors.get(where.id) ?? null },
    riderProfile: { findUnique: async ({ where }: any) => riders.get(where.id) ?? null },
    customerProfile: { findUnique: async ({ where }: any) => customers.get(where.id) ?? null },
    auditLog: {
      create: async ({ data }: any) => {
        const a = { id: id(), createdAt: new Date(), ...data };
        auditLog.push(a);
        return a;
      },
    },
    __state: { orders, vendors, riders, customers, items, transitions, payments, ledgerEntries, auditLog },
  };

  function withRelations(order: any, include: any) {
    const out: any = { ...order };
    if (include.items) out.items = items.filter((i) => i.orderId === order.id);
    if (include.transitions) out.transitions = transitions.filter((t) => t.orderId === order.id);
    if (include.vendor) out.vendor = vendors.get(order.vendorId) ?? null;
    if (include.rider) out.rider = order.riderId ? (riders.get(order.riderId) ?? null) : null;
    return out;
  }

  return db as unknown as PrismaClient & { __state: typeof db.__state };
}

function createFakeMonnify(overrides?: Partial<MonnifyClient>): MonnifyClient {
  return {
    initializeTransaction: vi.fn().mockResolvedValue({ checkoutUrl: "https://x", transactionReference: "t" }),
    verifyWebhookSignature: vi.fn().mockReturnValue(true),
    refund: vi.fn().mockResolvedValue(undefined),
    transfer: vi.fn().mockResolvedValue({ status: "SUCCESS", providerReference: "t" }),
    ...overrides,
  };
}

function createFakeNotifications(): NotificationService {
  return { notify: vi.fn().mockResolvedValue(undefined) } as unknown as NotificationService;
}

const ADMIN_ID = "admin_1";
const ORDER_ID = "order_1";
const VENDOR_ID = "vendor_1";
const RIDER_ID = "rider_1";

function baseOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: ORDER_ID,
    vendorId: VENDOR_ID,
    riderId: null,
    customerId: null,
    status: "PAID",
    fulfilmentType: "delivery",
    totalMinor: 500000,
    createdAt: new Date(),
    ...overrides,
  };
}

describe("admin order oversight — listOrders/getOrder", () => {
  it("returns the order with its full transition history and vendor/rider joined", async () => {
    const prisma = createFakePrisma();
    prisma.__state.orders.set(ORDER_ID, baseOrder());
    prisma.__state.vendors.set(VENDOR_ID, { businessName: "Ada's Kitchen" });
    prisma.__state.transitions.push({ id: "t1", orderId: ORDER_ID, fromStatus: null, toStatus: "PAID", createdAt: new Date() });

    const svc = createAdminOrderService({ prisma, monnify: createFakeMonnify(), notifications: createFakeNotifications() });
    const order = await svc.getOrder(ORDER_ID);

    expect((order as any).vendor.businessName).toBe("Ada's Kitchen");
    expect((order as any).transitions).toHaveLength(1);
  });

  it("throws for a nonexistent order", async () => {
    const prisma = createFakePrisma();
    const svc = createAdminOrderService({ prisma, monnify: createFakeMonnify(), notifications: createFakeNotifications() });
    await expect(svc.getOrder("nope")).rejects.toThrow(OrderNotFoundError);
  });

  it("filters the list by status", async () => {
    const prisma = createFakePrisma();
    prisma.__state.orders.set("a", baseOrder({ id: "a", status: "PAID" }));
    prisma.__state.orders.set("b", baseOrder({ id: "b", status: "COMPLETED" }));
    prisma.__state.vendors.set(VENDOR_ID, { businessName: "Ada's Kitchen" });

    const svc = createAdminOrderService({ prisma, monnify: createFakeMonnify(), notifications: createFakeNotifications() });
    const { orders } = await svc.listOrders({ status: "PAID", limit: 30 } as any);

    expect(orders).toHaveLength(1);
    expect((orders[0] as any).id).toBe("a");
  });
});

describe("admin order oversight — reassignRider", () => {
  let prisma: ReturnType<typeof createFakePrisma>;

  beforeEach(() => {
    prisma = createFakePrisma();
    prisma.__state.riders.set(RIDER_ID, { id: RIDER_ID, userId: "rider_user_1" });
  });

  it("clears the rider and reverts to READY_FOR_PICKUP, so the job re-enters the open pool", async () => {
    prisma.__state.orders.set(ORDER_ID, baseOrder({ riderId: RIDER_ID, status: "RIDER_ASSIGNED" }));
    const notifications = createFakeNotifications();
    const svc = createAdminOrderService({ prisma, monnify: createFakeMonnify(), notifications });

    const updated = await svc.reassignRider(ADMIN_ID, ORDER_ID, "Rider unresponsive");

    expect((updated as any).riderId).toBeNull();
    expect((updated as any).status).toBe("READY_FOR_PICKUP");
    expect(notifications.notify).toHaveBeenCalledWith("rider_user_1", "order_reassigned", expect.objectContaining({ orderId: ORDER_ID }));
  });

  it("rejects an order with no rider assigned", async () => {
    prisma.__state.orders.set(ORDER_ID, baseOrder({ riderId: null, status: "READY_FOR_PICKUP" }));
    const svc = createAdminOrderService({ prisma, monnify: createFakeMonnify(), notifications: createFakeNotifications() });

    await expect(svc.reassignRider(ADMIN_ID, ORDER_ID, "reason")).rejects.toThrow(NoRiderAssignedError);
  });

  it("rejects reassignment once the order is already DELIVERED", async () => {
    prisma.__state.orders.set(ORDER_ID, baseOrder({ riderId: RIDER_ID, status: "DELIVERED" }));
    const svc = createAdminOrderService({ prisma, monnify: createFakeMonnify(), notifications: createFakeNotifications() });

    await expect(svc.reassignRider(ADMIN_ID, ORDER_ID, "reason")).rejects.toThrow(InvalidOrderStateError);
  });
});

describe("admin order oversight — forceCancelOrder", () => {
  it("cancels and refunds a paid order in one action", async () => {
    const prisma = createFakePrisma();
    prisma.__state.orders.set(ORDER_ID, baseOrder({ status: "PREPARING" }));
    prisma.__state.payments.set(ORDER_ID, { id: "pay_1", orderId: ORDER_ID, status: "succeeded", gateway: "card", gatewayReference: "ref_1" });
    prisma.__state.vendors.set(VENDOR_ID, { userId: "vendor_user_1" });
    const monnify = createFakeMonnify();
    const notifications = createFakeNotifications();
    const svc = createAdminOrderService({ prisma, monnify, notifications });

    const result = await svc.forceCancelOrder(ADMIN_ID, ORDER_ID, "Wrong item shipped");

    expect((result as any).status).toBe("REFUNDED");
    expect(monnify.refund).toHaveBeenCalledTimes(1);
    expect(notifications.notify).toHaveBeenCalledWith("vendor_user_1", "order_force_cancelled", expect.anything());
  });

  it("still cancels a cash order that was never actually charged, without erroring on the refund step", async () => {
    const prisma = createFakePrisma();
    prisma.__state.orders.set(ORDER_ID, baseOrder({ status: "PREPARING", paymentMethod: "cash_on_delivery" }));
    prisma.__state.payments.set(ORDER_ID, { id: "pay_1", orderId: ORDER_ID, status: "pending", gateway: "cash", gatewayReference: "ref_1" });
    prisma.__state.vendors.set(VENDOR_ID, { userId: "vendor_user_1" });
    const svc = createAdminOrderService({ prisma, monnify: createFakeMonnify(), notifications: createFakeNotifications() });

    const result = await svc.forceCancelOrder(ADMIN_ID, ORDER_ID, "Out of stock");
    expect((result as any).status).toBe("CANCELLED");
  });

  it("rejects force-cancelling an order already in a terminal state", async () => {
    const prisma = createFakePrisma();
    prisma.__state.orders.set(ORDER_ID, baseOrder({ status: "COMPLETED" }));
    const svc = createAdminOrderService({ prisma, monnify: createFakeMonnify(), notifications: createFakeNotifications() });

    await expect(svc.forceCancelOrder(ADMIN_ID, ORDER_ID, "reason")).rejects.toThrow(InvalidOrderStateError);
  });
});

describe("admin order oversight — forceRefundOrder", () => {
  it("refunds without touching the order's own status", async () => {
    const prisma = createFakePrisma();
    prisma.__state.orders.set(ORDER_ID, baseOrder({ status: "DELIVERED" }));
    prisma.__state.payments.set(ORDER_ID, { id: "pay_1", orderId: ORDER_ID, status: "succeeded", gateway: "card", gatewayReference: "ref_1" });
    const monnify = createFakeMonnify();
    const svc = createAdminOrderService({ prisma, monnify, notifications: createFakeNotifications() });

    await svc.forceRefundOrder(ADMIN_ID, ORDER_ID, "Cold food, goodwill refund");

    expect(monnify.refund).toHaveBeenCalledTimes(1);
    expect((prisma.__state.orders.get(ORDER_ID) as any).status).toBe("DELIVERED"); // untouched
    expect((prisma.__state.payments.get(ORDER_ID) as any).status).toBe("refunded");
  });

  it("rejects refunding an order that was never charged", async () => {
    const prisma = createFakePrisma();
    prisma.__state.orders.set(ORDER_ID, baseOrder({ status: "DELIVERED", paymentMethod: "cash_on_delivery" }));
    prisma.__state.payments.set(ORDER_ID, { id: "pay_1", orderId: ORDER_ID, status: "pending", gateway: "cash", gatewayReference: "ref_1" });
    const svc = createAdminOrderService({ prisma, monnify: createFakeMonnify(), notifications: createFakeNotifications() });

    await expect(svc.forceRefundOrder(ADMIN_ID, ORDER_ID, "reason")).rejects.toThrow(NothingToRefundError);
  });

  it("rejects refunding an order already refunded", async () => {
    const prisma = createFakePrisma();
    prisma.__state.orders.set(ORDER_ID, baseOrder({ status: "REFUNDED" }));
    prisma.__state.payments.set(ORDER_ID, { id: "pay_1", orderId: ORDER_ID, status: "refunded", gateway: "card", gatewayReference: "ref_1" });
    const svc = createAdminOrderService({ prisma, monnify: createFakeMonnify(), notifications: createFakeNotifications() });

    await expect(svc.forceRefundOrder(ADMIN_ID, ORDER_ID, "reason")).rejects.toThrow(NothingToRefundError);
  });
});
