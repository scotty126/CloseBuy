import { describe, it, expect, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  createDispatchService,
  RiderAlreadyExistsError,
  RiderNotFoundError,
  JobUnavailableError,
  InvalidCollectionCodeError,
  CashAmountMismatchError,
} from "./service.js";
import type { OrderQueue } from "../order/jobs.js";
import type { NotificationService } from "../notifications/service.js";

function createFakePrisma() {
  const riders = new Map<string, any>();
  const orders = new Map<string, any>();
  const customers = new Map<string, any>();
  const transitions: any[] = [];
  const ledgerEntries: any[] = [];
  let nextId = 1;
  const id = () => `id_${nextId++}`;

  const db = {
    customerProfile: {
      findUnique: async ({ where }: any) => customers.get(where.id) ?? null,
    },
    riderProfile: {
      findUnique: async ({ where }: any) =>
        where.id ? (riders.get(where.id) ?? null) : [...riders.values()].find((r) => r.userId === where.userId) ?? null,
      create: async ({ data }: any) => {
        const rider = { id: id(), cashBalanceMinor: 0, onDuty: false, ...data };
        riders.set(rider.id, rider);
        return rider;
      },
      update: async ({ where, data }: any) => {
        const r = where.id ? riders.get(where.id) : [...riders.values()].find((x) => x.userId === where.userId);
        const updated = { ...r, ...applyOps(r, data) };
        riders.set(r.id, updated);
        return updated;
      },
    },
    order: {
      findUnique: async ({ where }: any) => orders.get(where.id) ?? null,
      findUniqueOrThrow: async ({ where }: any) => {
        const o = orders.get(where.id);
        if (!o) throw new Error("not found");
        return o;
      },
      findMany: async ({ where }: any) =>
        [...orders.values()].filter((o) => {
          if (where.riderId !== undefined && o.riderId !== where.riderId) return false;
          if (where.status && o.status !== where.status) return false;
          if (where.fulfilmentType && o.fulfilmentType !== where.fulfilmentType) return false;
          return true;
        }),
      findFirst: async ({ where }: any) =>
        [...orders.values()].find((o) => {
          if (where.riderId !== undefined && o.riderId !== where.riderId) return false;
          if (where.status?.in && !where.status.in.includes(o.status)) return false;
          return true;
        }) ?? null,
      update: async ({ where, data }: any) => {
        const o = orders.get(where.id);
        const updated = { ...o, ...applyOps(o, data) };
        orders.set(where.id, updated);
        return updated;
      },
      // The atomic claim this whole module depends on.
      updateMany: async ({ where, data }: any) => {
        const o = orders.get(where.id);
        if (!o || o.riderId !== where.riderId || o.status !== where.status || o.fulfilmentType !== where.fulfilmentType) {
          return { count: 0 };
        }
        orders.set(where.id, { ...o, ...data });
        return { count: 1 };
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
    config: {
      // Same default as prisma/seed.ts — the only Config key this module reads.
      findFirst: async ({ where }: any) => (where.key === "escrow_release_window_hours" ? { key: where.key, value: 48 } : null),
    },
    __state: { riders, orders, customers, transitions, ledgerEntries },
  };

  function applyOps(existing: any, data: any) {
    const out: any = {};
    for (const [k, v] of Object.entries(data)) {
      if (v && typeof v === "object" && "increment" in (v as any)) out[k] = existing[k] + (v as any).increment;
      else out[k] = v;
    }
    return out;
  }

  return db as unknown as PrismaClient & { __state: typeof db.__state };
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

const RIDER_USER_ID = "rider_user_1";
const RIDER_ID = "rider_1";
const ORDER_ID = "order_1";
const CUSTOMER_ID = "customer_1";
const CUSTOMER_USER_ID = "customer_user_1";

function seedApprovedOnDutyRider(prisma: ReturnType<typeof createFakePrisma>) {
  prisma.__state.riders.set(RIDER_ID, { id: RIDER_ID, userId: RIDER_USER_ID, status: "approved", onDuty: true, cashBalanceMinor: 0, fullName: "Musa" });
}

function seedOpenOrder(prisma: ReturnType<typeof createFakePrisma>, overrides?: any) {
  prisma.__state.orders.set(ORDER_ID, {
    id: ORDER_ID,
    status: "READY_FOR_PICKUP",
    fulfilmentType: "delivery",
    riderId: null,
    collectionCode: "123456",
    paymentMethod: "card",
    totalMinor: 500000,
    deliveryFeeMinor: 50000,
    updatedAt: new Date(),
    ...overrides,
  });
}

describe("dispatch service", () => {
  let prisma: ReturnType<typeof createFakePrisma>;
  let queue: OrderQueue;
  let notifications: NotificationService;

  beforeEach(() => {
    prisma = createFakePrisma();
    queue = createFakeQueue();
    notifications = createFakeNotifications();
    prisma.__state.customers.set(CUSTOMER_ID, { id: CUSTOMER_ID, userId: CUSTOMER_USER_ID });
  });

  function service() {
    return createDispatchService({ prisma, queue, notifications });
  }

  it("submits a rider application in pending status", async () => {
    const rider = await service().applyToRide(RIDER_USER_ID, { fullName: "Musa", vehicleType: "motorcycle", idDocumentUrl: "https://example.com/id.jpg" });
    expect(rider.status).toBe("pending");
  });

  it("rejects a second application from the same account", async () => {
    const svc = service();
    await svc.applyToRide(RIDER_USER_ID, { fullName: "Musa", vehicleType: "motorcycle", idDocumentUrl: "https://example.com/id.jpg" });
    await expect(svc.applyToRide(RIDER_USER_ID, { fullName: "Musa", vehicleType: "motorcycle", idDocumentUrl: "https://example.com/id.jpg" })).rejects.toThrow(RiderAlreadyExistsError);
  });

  it("an unapproved rider cannot go on duty", async () => {
    prisma.__state.riders.set(RIDER_ID, { id: RIDER_ID, userId: RIDER_USER_ID, status: "pending", onDuty: false, cashBalanceMinor: 0 });
    await expect(service().setDuty(RIDER_USER_ID, { onDuty: true })).rejects.toThrow(RiderNotFoundError);
  });

  it("an off-duty rider sees no open jobs, even if some exist", async () => {
    prisma.__state.riders.set(RIDER_ID, { id: RIDER_ID, userId: RIDER_USER_ID, status: "approved", onDuty: false, cashBalanceMinor: 0 });
    seedOpenOrder(prisma);
    expect(await service().listOpenJobs(RIDER_USER_ID)).toHaveLength(0);
  });

  it("an on-duty rider sees an open delivery job", async () => {
    seedApprovedOnDutyRider(prisma);
    seedOpenOrder(prisma);
    const jobs = await service().listOpenJobs(RIDER_USER_ID);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.id).toBe(ORDER_ID);
  });

  it("claiming a job assigns it and moves it to RIDER_ASSIGNED", async () => {
    seedApprovedOnDutyRider(prisma);
    seedOpenOrder(prisma);

    const order = await service().claimJob(RIDER_USER_ID, ORDER_ID);
    expect(order.status).toBe("RIDER_ASSIGNED");
    expect(order.riderId).toBe(RIDER_ID);
  });

  it("two riders racing for the same job — only one wins, atomically (US-R-03)", async () => {
    seedApprovedOnDutyRider(prisma);
    prisma.__state.riders.set("rider_2", { id: "rider_2", userId: "rider_user_2", status: "approved", onDuty: true, cashBalanceMinor: 0 });
    seedOpenOrder(prisma);

    const svcA = createDispatchService({ prisma, queue, notifications });
    const svcB = createDispatchService({ prisma, queue, notifications });

    const results = await Promise.allSettled([svcA.claimJob(RIDER_USER_ID, ORDER_ID), svcB.claimJob("rider_user_2", ORDER_ID)]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(JobUnavailableError);
  });

  it("confirmCollection: wrong code is rejected, right code moves the order to IN_TRANSIT", async () => {
    seedApprovedOnDutyRider(prisma);
    seedOpenOrder(prisma, { status: "RIDER_ASSIGNED", riderId: RIDER_ID });

    await expect(service().confirmCollection(RIDER_USER_ID, ORDER_ID, { code: "000000" })).rejects.toThrow(InvalidCollectionCodeError);

    const order = await service().confirmCollection(RIDER_USER_ID, ORDER_ID, { code: "123456" });
    expect(order.status).toBe("IN_TRANSIT");
  });

  it("notifies the customer at each stage — assigned, in transit, delivered — never for a guest order", async () => {
    seedApprovedOnDutyRider(prisma);
    seedOpenOrder(prisma, { customerId: CUSTOMER_ID });

    await service().claimJob(RIDER_USER_ID, ORDER_ID);
    expect(notifications.notify).toHaveBeenCalledWith(CUSTOMER_USER_ID, "order_rider_assigned", { orderId: ORDER_ID });

    await service().confirmCollection(RIDER_USER_ID, ORDER_ID, { code: "123456" });
    expect(notifications.notify).toHaveBeenCalledWith(CUSTOMER_USER_ID, "order_in_transit", { orderId: ORDER_ID });

    await service().confirmDelivery(RIDER_USER_ID, ORDER_ID, { recipientName: "John" });
    expect(notifications.notify).toHaveBeenCalledWith(CUSTOMER_USER_ID, "order_delivered", { orderId: ORDER_ID });

    (notifications.notify as any).mockClear();
    seedOpenOrder(prisma, { customerId: null }); // guest order — reset back to READY_FOR_PICKUP, unclaimed
    await service().claimJob(RIDER_USER_ID, ORDER_ID);
    expect(notifications.notify).not.toHaveBeenCalledWith(expect.anything(), "order_rider_assigned", expect.anything());
  });

  it("confirmDelivery: card/transfer order needs no cash amount, completes cleanly, schedules escrow release", async () => {
    seedApprovedOnDutyRider(prisma);
    seedOpenOrder(prisma, { status: "IN_TRANSIT", riderId: RIDER_ID, paymentMethod: "card" });

    const order = await service().confirmDelivery(RIDER_USER_ID, ORDER_ID, { recipientName: "John" });
    expect(order.status).toBe("DELIVERED");
    expect(queue.scheduleEscrowRelease).toHaveBeenCalledWith(ORDER_ID, expect.any(Number));
    expect(prisma.__state.ledgerEntries).toHaveLength(0); // nothing to post — card/transfer already has its escrow entries from checkout
  });

  it("confirmDelivery: cash on delivery requires the exact total, and posts the collection ledger entries when correct", async () => {
    seedApprovedOnDutyRider(prisma);
    seedOpenOrder(prisma, { status: "IN_TRANSIT", riderId: RIDER_ID, paymentMethod: "cash_on_delivery", totalMinor: 500000 });

    await expect(
      service().confirmDelivery(RIDER_USER_ID, ORDER_ID, { recipientName: "John", cashCollectedMinor: 400000 }),
    ).rejects.toThrow(CashAmountMismatchError);
    // Rejected attempt must not have moved the order or touched the rider's balance.
    expect(prisma.__state.orders.get(ORDER_ID).status).toBe("IN_TRANSIT");
    expect(prisma.__state.riders.get(RIDER_ID).cashBalanceMinor).toBe(0);

    const order = await service().confirmDelivery(RIDER_USER_ID, ORDER_ID, { recipientName: "John", cashCollectedMinor: 500000 });
    expect(order.status).toBe("DELIVERED");
    expect(prisma.__state.riders.get(RIDER_ID).cashBalanceMinor).toBe(500000); // now owed back to the platform (US-R-08)
    expect(prisma.__state.ledgerEntries).toHaveLength(2); // codCollectionEntries — debit rider_cash_float, credit customer_escrow
  });

  it("earnings: separates cleared (COMPLETED) from pending (still in flight), and surfaces the cash float", async () => {
    seedApprovedOnDutyRider(prisma);
    prisma.__state.riders.set(RIDER_ID, { ...prisma.__state.riders.get(RIDER_ID), cashBalanceMinor: 150000 });
    prisma.__state.orders.set("order_done", { id: "order_done", riderId: RIDER_ID, status: "COMPLETED", deliveryFeeMinor: 50000, updatedAt: new Date() });
    prisma.__state.orders.set("order_active", { id: "order_active", riderId: RIDER_ID, status: "IN_TRANSIT", deliveryFeeMinor: 50000, updatedAt: new Date() });

    const earnings = await service().getEarnings(RIDER_USER_ID);
    expect(earnings.clearedMinor).toBe(50000);
    expect(earnings.pendingMinor).toBe(50000);
    expect(earnings.cashBalanceMinor).toBe(150000);
    expect(earnings.deliveries).toHaveLength(1);
  });

  it("getActiveJob: finds the rider's current in-progress order (RIDER_ASSIGNED or IN_TRANSIT), with vendor pickup details, and nothing once it's DELIVERED", async () => {
    seedApprovedOnDutyRider(prisma);
    prisma.__state.orders.set(ORDER_ID, {
      id: ORDER_ID, riderId: RIDER_ID, status: "RIDER_ASSIGNED", fulfilmentType: "delivery",
      vendor: { businessName: "Ada's Kitchen" },
    });

    const active = await service().getActiveJob(RIDER_USER_ID);
    expect(active?.id).toBe(ORDER_ID);
    expect((active as any).vendor.businessName).toBe("Ada's Kitchen");

    prisma.__state.orders.set(ORDER_ID, { ...prisma.__state.orders.get(ORDER_ID), status: "DELIVERED" });
    expect(await service().getActiveJob(RIDER_USER_ID)).toBeNull();
  });
});
