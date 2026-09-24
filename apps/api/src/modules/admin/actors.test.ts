import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createAdminActorService, ActorNotFoundError, InvalidActorStateError } from "./actors.js";
import type { NotificationService } from "../notifications/service.js";

/** In-memory fake Prisma — covers exactly what admin/actors.ts touches. */
function createFakePrisma() {
  const vendors = new Map<string, any>();
  const riders = new Map<string, any>();
  const orders = new Map<string, any>();
  const auditLog: any[] = [];
  let nextId = 1;
  const id = () => `id_${nextId++}`;

  const db = {
    vendorProfile: {
      findUnique: async ({ where }: any) => vendors.get(where.id) ?? null,
      findMany: async () => [...vendors.values()],
      update: async ({ where, data }: any) => {
        const updated = { ...vendors.get(where.id), ...data };
        vendors.set(where.id, updated);
        return updated;
      },
    },
    riderProfile: {
      findUnique: async ({ where }: any) => riders.get(where.id) ?? null,
      findMany: async () => [...riders.values()],
      update: async ({ where, data }: any) => {
        const updated = { ...riders.get(where.id), ...data };
        riders.set(where.id, updated);
        return updated;
      },
    },
    order: {
      findMany: async ({ where }: any) => {
        return [...orders.values()].filter((o) => {
          if (where.vendorId !== undefined && o.vendorId !== where.vendorId) return false;
          if (where.riderId !== undefined && o.riderId !== where.riderId) return false;
          if (where.status?.in && !where.status.in.includes(o.status)) return false;
          return true;
        });
      },
    },
    auditLog: {
      create: async ({ data }: any) => {
        const a = { id: id(), createdAt: new Date(), ...data };
        auditLog.push(a);
        return a;
      },
    },
    __state: { vendors, riders, orders, auditLog },
  };

  return db as unknown as PrismaClient & { __state: typeof db.__state };
}

function createFakeNotifications(): NotificationService {
  return { notify: vi.fn().mockResolvedValue(undefined) } as unknown as NotificationService;
}

const ADMIN_ID = "admin_1";
const VENDOR_ID = "vendor_1";
const RIDER_ID = "rider_1";

describe("admin actors — suspendVendor/unsuspendVendor", () => {
  it("suspends an approved vendor, notifies them, and surfaces in-flight orders", async () => {
    const prisma = createFakePrisma();
    prisma.__state.vendors.set(VENDOR_ID, { id: VENDOR_ID, userId: "vendor_user_1", status: "approved" });
    prisma.__state.orders.set("o1", { id: "o1", vendorId: VENDOR_ID, status: "PREPARING" });
    prisma.__state.orders.set("o2", { id: "o2", vendorId: VENDOR_ID, status: "COMPLETED" }); // terminal — shouldn't show up
    const notifications = createFakeNotifications();
    const svc = createAdminActorService({ prisma, notifications });

    const { vendor, inFlightOrders } = await svc.suspendVendor(ADMIN_ID, VENDOR_ID, "Multiple complaints of spoiled food");

    expect((vendor as any).status).toBe("suspended");
    expect(inFlightOrders).toHaveLength(1);
    expect((inFlightOrders[0] as any).id).toBe("o1");
    expect(notifications.notify).toHaveBeenCalledWith("vendor_user_1", "vendor_suspended", expect.anything());
  });

  it("refuses to suspend a vendor that isn't currently approved", async () => {
    const prisma = createFakePrisma();
    prisma.__state.vendors.set(VENDOR_ID, { id: VENDOR_ID, userId: "vendor_user_1", status: "pending" });
    const svc = createAdminActorService({ prisma, notifications: createFakeNotifications() });

    await expect(svc.suspendVendor(ADMIN_ID, VENDOR_ID, "reason")).rejects.toThrow(InvalidActorStateError);
  });

  it("throws for a nonexistent vendor", async () => {
    const prisma = createFakePrisma();
    const svc = createAdminActorService({ prisma, notifications: createFakeNotifications() });
    await expect(svc.suspendVendor(ADMIN_ID, "nope", "reason")).rejects.toThrow(ActorNotFoundError);
  });

  it("reverses a suspension back to approved", async () => {
    const prisma = createFakePrisma();
    prisma.__state.vendors.set(VENDOR_ID, { id: VENDOR_ID, userId: "vendor_user_1", status: "suspended" });
    const notifications = createFakeNotifications();
    const svc = createAdminActorService({ prisma, notifications });

    const vendor = await svc.unsuspendVendor(ADMIN_ID, VENDOR_ID, "Appeal upheld");

    expect((vendor as any).status).toBe("approved");
    expect(notifications.notify).toHaveBeenCalledWith("vendor_user_1", "vendor_unsuspended", expect.anything());
  });

  it("refuses to unsuspend a vendor that isn't currently suspended", async () => {
    const prisma = createFakePrisma();
    prisma.__state.vendors.set(VENDOR_ID, { id: VENDOR_ID, userId: "vendor_user_1", status: "approved" });
    const svc = createAdminActorService({ prisma, notifications: createFakeNotifications() });

    await expect(svc.unsuspendVendor(ADMIN_ID, VENDOR_ID, "reason")).rejects.toThrow(InvalidActorStateError);
  });
});

describe("admin actors — suspendRider/unsuspendRider", () => {
  it("suspends an approved rider, takes them off duty, and surfaces in-flight orders", async () => {
    const prisma = createFakePrisma();
    prisma.__state.riders.set(RIDER_ID, { id: RIDER_ID, userId: "rider_user_1", status: "approved", onDuty: true });
    prisma.__state.orders.set("o1", { id: "o1", riderId: RIDER_ID, status: "IN_TRANSIT" });
    const notifications = createFakeNotifications();
    const svc = createAdminActorService({ prisma, notifications });

    const { rider, inFlightOrders } = await svc.suspendRider(ADMIN_ID, RIDER_ID, "Failed to remit cash float");

    expect((rider as any).status).toBe("suspended");
    expect((rider as any).onDuty).toBe(false);
    expect(inFlightOrders).toHaveLength(1);
    expect(notifications.notify).toHaveBeenCalledWith("rider_user_1", "rider_suspended", expect.anything());
  });

  it("refuses to suspend a rider that isn't currently approved", async () => {
    const prisma = createFakePrisma();
    prisma.__state.riders.set(RIDER_ID, { id: RIDER_ID, userId: "rider_user_1", status: "suspended", onDuty: false });
    const svc = createAdminActorService({ prisma, notifications: createFakeNotifications() });

    await expect(svc.suspendRider(ADMIN_ID, RIDER_ID, "reason")).rejects.toThrow(InvalidActorStateError);
  });

  it("reverses a suspension back to approved", async () => {
    const prisma = createFakePrisma();
    prisma.__state.riders.set(RIDER_ID, { id: RIDER_ID, userId: "rider_user_1", status: "suspended", onDuty: false });
    const notifications = createFakeNotifications();
    const svc = createAdminActorService({ prisma, notifications });

    const rider = await svc.unsuspendRider(ADMIN_ID, RIDER_ID, "Appeal upheld");

    expect((rider as any).status).toBe("approved");
    expect(notifications.notify).toHaveBeenCalledWith("rider_user_1", "rider_unsuspended", expect.anything());
  });
});
