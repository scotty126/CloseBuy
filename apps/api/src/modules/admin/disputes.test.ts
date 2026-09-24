import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  createAdminDisputeService,
  DisputeNotFoundError,
  DisputeAlreadyResolvedError,
  InvalidResolutionError,
  NothingToRefundError,
} from "./disputes.js";
import type { MonnifyClient } from "../payments/monnify.js";
import type { NotificationService } from "../notifications/service.js";

/** In-memory fake Prisma — covers exactly what admin/disputes.ts touches. */
function createFakePrisma() {
  const disputes = new Map<string, any>();
  const orders = new Map<string, any>();
  const vendors = new Map<string, any>();
  const customers = new Map<string, any>();
  const payments = new Map<string, any>(); // keyed by orderId
  const transitions: any[] = [];
  const ledgerEntries: any[] = [];
  const auditLog: any[] = [];
  // Same defaults as prisma/seed.ts (order/service.test.ts's fake mirrors these too).
  const config = new Map<string, any>([
    ["commission_rate.pickup", 5],
    ["commission_rate.delivery", 10],
  ]);
  let nextId = 1;
  const id = () => `id_${nextId++}`;

  const db = {
    dispute: {
      findUnique: async ({ where }: any) => disputes.get(where.id) ?? null,
      update: async ({ where, data }: any) => {
        const updated = { ...disputes.get(where.id), ...data };
        disputes.set(where.id, updated);
        return updated;
      },
      findMany: async ({ where, take, cursor, skip }: any) => {
        let list = [...disputes.values()]
          .filter((d) => where?.status === undefined || d.status === where.status)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        if (cursor) {
          const idx = list.findIndex((d) => d.id === cursor.id);
          list = list.slice(idx + (skip ?? 0));
        }
        if (take) list = list.slice(0, take);
        return list.map((d) => ({ ...d, order: { ...orders.get(d.orderId), vendor: vendors.get(orders.get(d.orderId)?.vendorId) } }));
      },
    },
    order: {
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
    orderStateTransition: {
      create: async ({ data }: any) => {
        const t = { id: id(), createdAt: new Date(), ...data };
        transitions.push(t);
        return t;
      },
    },
    ledgerEntry: {
      createMany: async ({ data }: any) => {
        ledgerEntries.push(...data);
        return { count: data.length };
      },
    },
    vendorProfile: { findUnique: async ({ where }: any) => vendors.get(where.id) ?? null },
    customerProfile: { findUnique: async ({ where }: any) => customers.get(where.id) ?? null },
    config: {
      findFirst: async ({ where }: any) => (config.has(where.key) ? { key: where.key, value: config.get(where.key) } : null),
    },
    auditLog: {
      create: async ({ data }: any) => {
        const a = { id: id(), createdAt: new Date(), ...data };
        auditLog.push(a);
        return a;
      },
    },
    __state: { disputes, orders, vendors, customers, payments, transitions, ledgerEntries, auditLog },
  };

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
const DISPUTE_ID = "dispute_1";
const ORDER_ID = "order_1";
const VENDOR_ID = "vendor_1";

function baseOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: ORDER_ID,
    vendorId: VENDOR_ID,
    customerId: null,
    status: "DELIVERED",
    fulfilmentType: "delivery",
    totalMinor: 500000, // ₦5,000
    deliveryFeeMinor: 50000, // ₦500
    commissionMinor: 0,
    ...overrides,
  };
}

function baseDispute(overrides: Record<string, unknown> = {}) {
  return {
    id: DISPUTE_ID,
    orderId: ORDER_ID,
    customerId: null,
    reason: "Missing items",
    evidence: [],
    status: "open",
    resolution: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe("admin disputes — resolveDispute: full_refund", () => {
  it("reverses the whole order to the customer and marks it REFUNDED", async () => {
    const prisma = createFakePrisma();
    prisma.__state.disputes.set(DISPUTE_ID, baseDispute());
    prisma.__state.orders.set(ORDER_ID, baseOrder());
    prisma.__state.payments.set(ORDER_ID, { id: "pay_1", orderId: ORDER_ID, status: "succeeded", gateway: "card", gatewayReference: "ref_1" });
    prisma.__state.vendors.set(VENDOR_ID, { userId: "vendor_user_1" });
    const monnify = createFakeMonnify();
    const notifications = createFakeNotifications();
    const svc = createAdminDisputeService({ prisma, monnify, notifications });

    const resolved = await svc.resolveDispute(ADMIN_ID, DISPUTE_ID, { resolution: "full_refund", reason: "Confirmed missing items" });

    expect((resolved as any).status).toBe("resolved");
    expect(monnify.refund).toHaveBeenCalledWith(expect.objectContaining({ amountMinor: 500000 }));
    expect((prisma.__state.orders.get(ORDER_ID) as any).status).toBe("REFUNDED");
    expect((prisma.__state.payments.get(ORDER_ID) as any).status).toBe("refunded");
    expect(notifications.notify).toHaveBeenCalledWith("vendor_user_1", "dispute_resolved", expect.anything());
  });

  it("rejects a full refund on a cash order — nothing was ever charged through the gateway", async () => {
    const prisma = createFakePrisma();
    prisma.__state.disputes.set(DISPUTE_ID, baseDispute());
    prisma.__state.orders.set(ORDER_ID, baseOrder({ paymentMethod: "cash_on_delivery" }));
    prisma.__state.payments.set(ORDER_ID, { id: "pay_1", orderId: ORDER_ID, status: "pending", gateway: "cash", gatewayReference: "ref_1" });
    const svc = createAdminDisputeService({ prisma, monnify: createFakeMonnify(), notifications: createFakeNotifications() });

    await expect(
      svc.resolveDispute(ADMIN_ID, DISPUTE_ID, { resolution: "full_refund", reason: "reason" }),
    ).rejects.toThrow(NothingToRefundError);
  });
});

describe("admin disputes — resolveDispute: partial_refund", () => {
  it("splits the remainder between vendor/platform/rider and marks the order COMPLETED", async () => {
    const prisma = createFakePrisma();
    prisma.__state.disputes.set(DISPUTE_ID, baseDispute());
    prisma.__state.orders.set(ORDER_ID, baseOrder()); // total 500000, deliveryFee 50000
    prisma.__state.payments.set(ORDER_ID, { id: "pay_1", orderId: ORDER_ID, status: "succeeded", gateway: "card", gatewayReference: "ref_1" });
    const monnify = createFakeMonnify();
    const svc = createAdminDisputeService({ prisma, monnify, notifications: createFakeNotifications() });

    // Refund ₦2,000 of ₦5,000 — ₦3,000 left to release (₦500 delivery fee + ₦2,500 goods, 10% commission on goods = ₦250).
    await svc.resolveDispute(ADMIN_ID, DISPUTE_ID, { resolution: "partial_refund", amountMinor: 200000, reason: "Half the order was missing" });

    expect(monnify.refund).toHaveBeenCalledWith(expect.objectContaining({ amountMinor: 200000 }));
    expect((prisma.__state.orders.get(ORDER_ID) as any).status).toBe("COMPLETED");
    expect((prisma.__state.orders.get(ORDER_ID) as any).commissionMinor).toBe(25000);
    expect((prisma.__state.payments.get(ORDER_ID) as any).status).toBe("partially_refunded");

    const rows = prisma.__state.ledgerEntries;
    const debits = rows.filter((r: any) => r.direction === "debit").reduce((s: number, r: any) => s + r.amountMinor, 0);
    const credits = rows.filter((r: any) => r.direction === "credit").reduce((s: number, r: any) => s + r.amountMinor, 0);
    expect(debits).toBe(credits); // double-entry invariant
    expect(debits).toBe(500000); // exactly the original escrow hold, split refund + release
  });

  it("rejects a partial refund amount that isn't actually partial", async () => {
    const prisma = createFakePrisma();
    prisma.__state.disputes.set(DISPUTE_ID, baseDispute());
    prisma.__state.orders.set(ORDER_ID, baseOrder());
    prisma.__state.payments.set(ORDER_ID, { id: "pay_1", orderId: ORDER_ID, status: "succeeded", gateway: "card", gatewayReference: "ref_1" });
    const svc = createAdminDisputeService({ prisma, monnify: createFakeMonnify(), notifications: createFakeNotifications() });

    await expect(
      svc.resolveDispute(ADMIN_ID, DISPUTE_ID, { resolution: "partial_refund", amountMinor: 500000, reason: "reason" }),
    ).rejects.toThrow(InvalidResolutionError);
  });
});

describe("admin disputes — resolveDispute: rejected", () => {
  it("releases escrow in full, same as if no dispute had ever been opened", async () => {
    const prisma = createFakePrisma();
    prisma.__state.disputes.set(DISPUTE_ID, baseDispute());
    prisma.__state.orders.set(ORDER_ID, baseOrder());
    prisma.__state.payments.set(ORDER_ID, { id: "pay_1", orderId: ORDER_ID, status: "succeeded", gateway: "card", gatewayReference: "ref_1" });
    const monnify = createFakeMonnify();
    const svc = createAdminDisputeService({ prisma, monnify, notifications: createFakeNotifications() });

    const resolved = await svc.resolveDispute(ADMIN_ID, DISPUTE_ID, { resolution: "rejected", reason: "Evidence didn't support the claim" });

    expect(monnify.refund).not.toHaveBeenCalled();
    expect((resolved as any).resolution).toBe("rejected");
    expect((prisma.__state.orders.get(ORDER_ID) as any).status).toBe("COMPLETED");
    expect((prisma.__state.orders.get(ORDER_ID) as any).commissionMinor).toBe(45000); // 10% of the 450000 goods portion
  });
});

describe("admin disputes — resolveDispute guards", () => {
  it("throws for a nonexistent dispute", async () => {
    const prisma = createFakePrisma();
    const svc = createAdminDisputeService({ prisma, monnify: createFakeMonnify(), notifications: createFakeNotifications() });
    await expect(svc.resolveDispute(ADMIN_ID, "nope", { resolution: "rejected", reason: "r" })).rejects.toThrow(DisputeNotFoundError);
  });

  it("throws for a dispute that's already resolved", async () => {
    const prisma = createFakePrisma();
    prisma.__state.disputes.set(DISPUTE_ID, baseDispute({ status: "resolved" }));
    const svc = createAdminDisputeService({ prisma, monnify: createFakeMonnify(), notifications: createFakeNotifications() });
    await expect(svc.resolveDispute(ADMIN_ID, DISPUTE_ID, { resolution: "rejected", reason: "r" })).rejects.toThrow(DisputeAlreadyResolvedError);
  });
});

describe("admin disputes — listDisputes", () => {
  it("filters by status", async () => {
    const prisma = createFakePrisma();
    prisma.__state.orders.set(ORDER_ID, baseOrder());
    prisma.__state.vendors.set(VENDOR_ID, { businessName: "Ada's Kitchen" });
    prisma.__state.disputes.set("open_1", baseDispute({ id: "open_1", status: "open", createdAt: new Date() }));
    prisma.__state.disputes.set("resolved_1", baseDispute({ id: "resolved_1", status: "resolved", createdAt: new Date() }));

    const svc = createAdminDisputeService({ prisma, monnify: createFakeMonnify(), notifications: createFakeNotifications() });
    const { disputes } = await svc.listDisputes({ status: "open", limit: 30 } as any);

    expect(disputes).toHaveLength(1);
    expect((disputes[0] as any).id).toBe("open_1");
  });
});
