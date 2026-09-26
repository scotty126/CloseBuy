import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createAdminRemittanceService, RiderNotFoundError, RemittanceExceedsBalanceError } from "./remittances.js";
import type { NotificationService } from "../notifications/service.js";

/**
 * In-memory fake Prisma — covers exactly what admin/remittances.ts touches.
 * `$transaction` snapshots the state up front and restores it if the callback
 * throws, so a test can actually observe the atomicity the real one provides
 * rather than just trusting that a thrown error means nothing was written.
 */
function createFakePrisma() {
  const riders = new Map<string, any>();
  const remittances: any[] = [];
  const auditLog: any[] = [];
  let nextId = 1;
  const id = () => `id_${nextId++}`;

  const db: any = {
    riderProfile: {
      findUnique: async ({ where }: any) => riders.get(where.id) ?? null,
      findUniqueOrThrow: async ({ where }: any) => {
        const r = riders.get(where.id);
        if (!r) throw new Error("not found");
        return r;
      },
      // The guarded decrement the whole module relies on: only matches while
      // the balance still covers the amount.
      updateMany: async ({ where, data }: any) => {
        const r = riders.get(where.id);
        if (!r || r.cashBalanceMinor < where.cashBalanceMinor.gte) return { count: 0 };
        riders.set(where.id, { ...r, cashBalanceMinor: r.cashBalanceMinor - data.cashBalanceMinor.decrement });
        return { count: 1 };
      },
    },
    riderCashRemittance: {
      create: async ({ data }: any) => {
        const row = { id: id(), createdAt: new Date(), note: null, ...data };
        remittances.push(row);
        return row;
      },
      findMany: async ({ where }: any) =>
        remittances.filter((r) => r.riderId === where.riderId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    },
    auditLog: {
      create: async ({ data }: any) => {
        const a = { id: id(), createdAt: new Date(), ...data };
        auditLog.push(a);
        return a;
      },
    },
    $transaction: async (fn: any) => {
      const snapshot = {
        riders: new Map([...riders].map(([k, v]) => [k, { ...v }])),
        remittances: [...remittances],
        auditLog: [...auditLog],
      };
      try {
        return await fn(db);
      } catch (err) {
        riders.clear();
        snapshot.riders.forEach((v, k) => riders.set(k, v));
        remittances.length = 0;
        remittances.push(...snapshot.remittances);
        auditLog.length = 0;
        auditLog.push(...snapshot.auditLog);
        throw err;
      }
    },
    __state: { riders, remittances, auditLog },
  };

  return db as PrismaClient & { __state: typeof db.__state };
}

function createFakeNotifications(): NotificationService {
  return { notify: vi.fn().mockResolvedValue(undefined) } as unknown as NotificationService;
}

const ADMIN_ID = "admin_1";
const RIDER_ID = "rider_1";

function seedRider(prisma: ReturnType<typeof createFakePrisma>, cashBalanceMinor: number) {
  prisma.__state.riders.set(RIDER_ID, { id: RIDER_ID, userId: "rider_user_1", status: "approved", cashBalanceMinor });
}

describe("admin remittances — recordRemittance (US-R-08)", () => {
  it("reduces the rider's balance immediately and records who recorded it", async () => {
    const prisma = createFakePrisma();
    seedRider(prisma, 500000);
    const svc = createAdminRemittanceService({ prisma, notifications: createFakeNotifications() });

    const { rider, remittance } = await svc.recordRemittance(ADMIN_ID, RIDER_ID, { amountMinor: 200000, note: "Handed to Ada at the depot" });

    expect((rider as any).cashBalanceMinor).toBe(300000);
    expect((remittance as any).recordedBy).toBe(ADMIN_ID);
    expect((remittance as any).amountMinor).toBe(200000);
    expect(prisma.__state.remittances).toHaveLength(1);
  });

  it("writes an audit log entry with the amount and note", async () => {
    const prisma = createFakePrisma();
    seedRider(prisma, 500000);
    const svc = createAdminRemittanceService({ prisma, notifications: createFakeNotifications() });

    await svc.recordRemittance(ADMIN_ID, RIDER_ID, { amountMinor: 150000, note: "Bank transfer" });

    expect(prisma.__state.auditLog).toHaveLength(1);
    expect(prisma.__state.auditLog[0]).toMatchObject({
      actorId: ADMIN_ID,
      action: "rider_cash_remitted",
      targetType: "rider_profile",
      targetId: RIDER_ID,
    });
    expect(prisma.__state.auditLog[0].reason).toContain("1500.00");
    expect(prisma.__state.auditLog[0].reason).toContain("Bank transfer");
  });

  it("notifies the rider with the new balance", async () => {
    const prisma = createFakePrisma();
    seedRider(prisma, 500000);
    const notifications = createFakeNotifications();
    const svc = createAdminRemittanceService({ prisma, notifications });

    await svc.recordRemittance(ADMIN_ID, RIDER_ID, { amountMinor: 500000 });

    expect(notifications.notify).toHaveBeenCalledWith(
      "rider_user_1",
      "rider_cash_remitted",
      expect.objectContaining({ amountMinor: 500000, balanceMinor: 0 }),
    );
  });

  it("can clear the balance to exactly zero", async () => {
    const prisma = createFakePrisma();
    seedRider(prisma, 500000);
    const svc = createAdminRemittanceService({ prisma, notifications: createFakeNotifications() });

    const { rider } = await svc.recordRemittance(ADMIN_ID, RIDER_ID, { amountMinor: 500000 });
    expect((rider as any).cashBalanceMinor).toBe(0);
  });

  it("refuses a remittance larger than the outstanding balance and leaves everything untouched (a typo'd extra zero can't drive it negative)", async () => {
    const prisma = createFakePrisma();
    seedRider(prisma, 500000);
    const notifications = createFakeNotifications();
    const svc = createAdminRemittanceService({ prisma, notifications });

    await expect(svc.recordRemittance(ADMIN_ID, RIDER_ID, { amountMinor: 5000000 })).rejects.toThrow(RemittanceExceedsBalanceError);

    expect(prisma.__state.riders.get(RIDER_ID).cashBalanceMinor).toBe(500000);
    expect(prisma.__state.remittances).toHaveLength(0);
    expect(prisma.__state.auditLog).toHaveLength(0);
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it("recording the same handback twice can't double-count: the second is refused once the balance no longer covers it", async () => {
    const prisma = createFakePrisma();
    seedRider(prisma, 500000);
    const svc = createAdminRemittanceService({ prisma, notifications: createFakeNotifications() });

    await svc.recordRemittance(ADMIN_ID, RIDER_ID, { amountMinor: 500000 });
    await expect(svc.recordRemittance(ADMIN_ID, RIDER_ID, { amountMinor: 500000 })).rejects.toThrow(RemittanceExceedsBalanceError);

    expect(prisma.__state.remittances).toHaveLength(1);
  });

  it("rejects a remittance for a rider who owes nothing", async () => {
    const prisma = createFakePrisma();
    seedRider(prisma, 0);
    const svc = createAdminRemittanceService({ prisma, notifications: createFakeNotifications() });

    await expect(svc.recordRemittance(ADMIN_ID, RIDER_ID, { amountMinor: 100 })).rejects.toThrow(RemittanceExceedsBalanceError);
  });

  it("throws for a nonexistent rider", async () => {
    const prisma = createFakePrisma();
    const svc = createAdminRemittanceService({ prisma, notifications: createFakeNotifications() });

    await expect(svc.recordRemittance(ADMIN_ID, "nope", { amountMinor: 100 })).rejects.toThrow(RiderNotFoundError);
  });

  it("rolls the balance change back if a later step in the same transaction fails — no balance drop without its remittance row", async () => {
    const prisma = createFakePrisma();
    seedRider(prisma, 500000);
    (prisma as any).auditLog.create = async () => {
      throw new Error("audit write failed");
    };
    const svc = createAdminRemittanceService({ prisma, notifications: createFakeNotifications() });

    await expect(svc.recordRemittance(ADMIN_ID, RIDER_ID, { amountMinor: 200000 })).rejects.toThrow("audit write failed");

    expect(prisma.__state.riders.get(RIDER_ID).cashBalanceMinor).toBe(500000);
    expect(prisma.__state.remittances).toHaveLength(0);
  });
});

describe("admin remittances — listRemittances", () => {
  it("lists one rider's remittances newest first", async () => {
    const prisma = createFakePrisma();
    seedRider(prisma, 0);
    prisma.__state.remittances.push(
      { id: "old", riderId: RIDER_ID, amountMinor: 1, createdAt: new Date("2026-09-01") },
      { id: "new", riderId: RIDER_ID, amountMinor: 2, createdAt: new Date("2026-09-10") },
      { id: "other", riderId: "other_rider", amountMinor: 3, createdAt: new Date("2026-09-05") },
    );
    const svc = createAdminRemittanceService({ prisma, notifications: createFakeNotifications() });

    const list = await svc.listRemittances(RIDER_ID);
    expect(list.map((r: any) => r.id)).toEqual(["new", "old"]);
  });

  it("throws for a nonexistent rider", async () => {
    const svc = createAdminRemittanceService({ prisma: createFakePrisma(), notifications: createFakeNotifications() });
    await expect(svc.listRemittances("nope")).rejects.toThrow(RiderNotFoundError);
  });
});
