import { describe, it, expect, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  createAdminService,
  ApplicationNotFoundError,
  InvalidApplicationStateError,
} from "./service.js";
import type { NotificationService } from "../notifications/service.js";

function createFakeNotifications(): NotificationService {
  return { notify: vi.fn().mockResolvedValue(undefined) } as unknown as NotificationService;
}

function createFakePrisma() {
  const vendors = new Map<string, any>();
  const riders = new Map<string, any>();
  const config = new Map<string, any>();
  const auditLog: any[] = [];

  const db = {
    vendorProfile: {
      findUnique: async ({ where }: any) => vendors.get(where.id) ?? null,
      findMany: async ({ where }: any) => [...vendors.values()].filter((v) => v.status === where.status),
      update: async ({ where, data }: any) => {
        const v = { ...vendors.get(where.id), ...data };
        vendors.set(where.id, v);
        return v;
      },
    },
    riderProfile: {
      findUnique: async ({ where }: any) => riders.get(where.id) ?? null,
      findMany: async ({ where }: any) => [...riders.values()].filter((r) => r.status === where.status),
      update: async ({ where, data }: any) => {
        const r = { ...riders.get(where.id), ...data };
        riders.set(where.id, r);
        return r;
      },
    },
    config: {
      findFirst: async ({ where }: any) => config.get(where.key) ?? null,
    },
    auditLog: {
      create: async ({ data }: any) => {
        const entry = { id: `log_${auditLog.length + 1}`, createdAt: new Date(), ...data };
        auditLog.push(entry);
        return entry;
      },
      findMany: async ({ where, take, cursor, skip }: any) => {
        let list = [...auditLog]
          .filter((e) => {
            if (where.actorId !== undefined && e.actorId !== where.actorId) return false;
            if (where.targetType !== undefined && e.targetType !== where.targetType) return false;
            if (where.targetId !== undefined && e.targetId !== where.targetId) return false;
            return true;
          })
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        if (cursor) {
          const idx = list.findIndex((e) => e.id === cursor.id);
          list = list.slice(idx + (skip ?? 0));
        }
        if (take) list = list.slice(0, take);
        return list;
      },
    },
    __state: { vendors, riders, config, auditLog },
  };

  return db as unknown as PrismaClient & { __state: typeof db.__state };
}

const VENDOR_ID = "vendor_1";
const VENDOR_USER_ID = "vendor_user_1";
const RIDER_ID = "rider_1";
const RIDER_USER_ID = "rider_user_1";
const ADMIN_USER_ID = "admin_user_1";

function seedPendingVendor(prisma: ReturnType<typeof createFakePrisma>, overrides?: any) {
  prisma.__state.vendors.set(VENDOR_ID, {
    id: VENDOR_ID,
    userId: VENDOR_USER_ID,
    businessName: "Musa's Store",
    status: "pending",
    createdAt: new Date("2026-01-01"),
    ...overrides,
  });
}

function seedPendingRider(prisma: ReturnType<typeof createFakePrisma>, overrides?: any) {
  prisma.__state.riders.set(RIDER_ID, {
    id: RIDER_ID,
    userId: RIDER_USER_ID,
    fullName: "Musa",
    status: "pending",
    createdAt: new Date("2026-01-02"),
    ...overrides,
  });
}

function setConfig(prisma: ReturnType<typeof createFakePrisma>, key: string, value: unknown) {
  prisma.__state.config.set(key, { key, value });
}

describe("admin service — application vetting (US-A-01)", () => {
  let prisma: ReturnType<typeof createFakePrisma>;
  let notifications: NotificationService;

  beforeEach(() => {
    prisma = createFakePrisma();
    notifications = createFakeNotifications();
    setConfig(prisma, "founding_vendor_program_active", true);
    setConfig(prisma, "founding_vendor_program_waiver_months", 3);
  });

  function service() {
    return createAdminService({ prisma, notifications });
  }

  it("lists pending vendor and rider applications together, oldest first", async () => {
    seedPendingRider(prisma); // createdAt 2026-01-02
    seedPendingVendor(prisma); // createdAt 2026-01-01
    prisma.__state.vendors.set("vendor_approved", { id: "vendor_approved", status: "approved", createdAt: new Date() });

    const applications = await service().listPendingApplications();

    expect(applications).toHaveLength(2);
    expect(applications[0]).toMatchObject({ type: "vendor", id: VENDOR_ID });
    expect(applications[1]).toMatchObject({ type: "rider", id: RIDER_ID });
  });

  it("approving a vendor while the Founding Vendor Program is active starts the commission-free window (US-A-01)", async () => {
    seedPendingVendor(prisma);

    const result = await service().approveApplication(ADMIN_USER_ID, "vendor", VENDOR_ID);
    if (result.type !== "vendor") throw new Error("expected a vendor application result");

    expect(result.status).toBe("approved");
    expect(result.foundingVendorCommissionWaivedUntil).toBeInstanceOf(Date);
    const monthsAhead = result.foundingVendorCommissionWaivedUntil!.getMonth() - new Date().getMonth();
    expect(((monthsAhead + 12) % 12)).toBe(3);
    expect(prisma.__state.auditLog).toHaveLength(1);
    expect(prisma.__state.auditLog[0]).toMatchObject({
      actorId: ADMIN_USER_ID,
      action: "vendor_application_approved",
      targetType: "vendor_profile",
      targetId: VENDOR_ID,
    });
    expect(notifications.notify).toHaveBeenCalledWith(
      VENDOR_USER_ID,
      "vendor_application_approved",
      expect.objectContaining({ vendorId: VENDOR_ID }),
    );
  });

  it("approving a vendor while the program is closed grants access without a waiver", async () => {
    setConfig(prisma, "founding_vendor_program_active", false);
    seedPendingVendor(prisma);

    const result = await service().approveApplication(ADMIN_USER_ID, "vendor", VENDOR_ID);
    if (result.type !== "vendor") throw new Error("expected a vendor application result");

    expect(result.status).toBe("approved");
    expect(result.foundingVendorCommissionWaivedUntil).toBeNull();
  });

  it("approving a rider needs no commission waiver logic and still logs the decision", async () => {
    seedPendingRider(prisma);

    const result = await service().approveApplication(ADMIN_USER_ID, "rider", RIDER_ID);

    expect(result.status).toBe("approved");
    expect(prisma.__state.auditLog[0]).toMatchObject({ action: "rider_application_approved", targetId: RIDER_ID });
    expect(notifications.notify).toHaveBeenCalledWith(RIDER_USER_ID, "rider_application_approved", { riderId: RIDER_ID });
  });

  it("rejecting requires a reason and records it on the audit log (US-A-01)", async () => {
    seedPendingVendor(prisma);

    const result = await service().rejectApplication(ADMIN_USER_ID, "vendor", VENDOR_ID, "Couldn't verify the business address.");

    expect(result.status).toBe("rejected");
    expect(prisma.__state.auditLog[0]).toMatchObject({
      action: "vendor_application_rejected",
      reason: "Couldn't verify the business address.",
    });
    expect(notifications.notify).toHaveBeenCalledWith(VENDOR_USER_ID, "vendor_application_rejected", {
      vendorId: VENDOR_ID,
      reason: "Couldn't verify the business address.",
    });
  });

  it("throws on an unknown application id", async () => {
    await expect(service().approveApplication(ADMIN_USER_ID, "vendor", "nope")).rejects.toThrow(ApplicationNotFoundError);
    await expect(service().rejectApplication(ADMIN_USER_ID, "rider", "nope", "reason")).rejects.toThrow(ApplicationNotFoundError);
  });

  it("refuses to re-decide an application that's already been approved or rejected", async () => {
    seedPendingVendor(prisma, { status: "approved" });
    seedPendingRider(prisma, { status: "rejected" });

    await expect(service().approveApplication(ADMIN_USER_ID, "vendor", VENDOR_ID)).rejects.toThrow(InvalidApplicationStateError);
    await expect(service().rejectApplication(ADMIN_USER_ID, "rider", RIDER_ID, "reason")).rejects.toThrow(InvalidApplicationStateError);
  });
});

describe("admin service — audit log search (US-A-08)", () => {
  it("finds everything this session's own actions already wrote, filtered by actor", async () => {
    const prisma = createFakePrisma();
    const notifications = createFakeNotifications();
    setConfig(prisma, "founding_vendor_program_active", false);
    setConfig(prisma, "founding_vendor_program_waiver_months", 3);
    const admin = createAdminService({ prisma, notifications });

    seedPendingVendor(prisma);
    await admin.approveApplication(ADMIN_USER_ID, "vendor", VENDOR_ID);
    seedPendingRider(prisma);
    await admin.rejectApplication("someone_else", "rider", RIDER_ID, "Incomplete documents");

    const { entries } = await admin.searchAuditLog({ actorId: ADMIN_USER_ID, limit: 50 } as any);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: "vendor_application_approved", targetId: VENDOR_ID });
  });

  it("filters by targetType and targetId", async () => {
    const prisma = createFakePrisma();
    const notifications = createFakeNotifications();
    setConfig(prisma, "founding_vendor_program_active", false);
    setConfig(prisma, "founding_vendor_program_waiver_months", 3);
    const admin = createAdminService({ prisma, notifications });

    seedPendingVendor(prisma);
    await admin.approveApplication(ADMIN_USER_ID, "vendor", VENDOR_ID);
    seedPendingRider(prisma);
    await admin.approveApplication(ADMIN_USER_ID, "rider", RIDER_ID);

    const { entries } = await admin.searchAuditLog({ targetType: "vendor_profile", targetId: VENDOR_ID, limit: 50 } as any);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ targetType: "vendor_profile", targetId: VENDOR_ID });
  });

  it("returns newest first", async () => {
    const prisma = createFakePrisma();
    const admin = createAdminService({ prisma, notifications: createFakeNotifications() });
    // Seeded directly with explicit timestamps — going through two real
    // service calls back to back can't guarantee distinct millisecond
    // clock values, which is the only thing this ordering test cares about.
    prisma.__state.auditLog.push(
      { id: "log_1", actorId: ADMIN_USER_ID, action: "vendor_application_approved", targetType: "vendor_profile", targetId: VENDOR_ID, createdAt: new Date("2026-01-01T10:00:00Z") },
      { id: "log_2", actorId: ADMIN_USER_ID, action: "rider_application_approved", targetType: "rider_profile", targetId: RIDER_ID, createdAt: new Date("2026-01-01T11:00:00Z") },
    );

    const { entries } = await admin.searchAuditLog({ limit: 50 } as any);

    expect(entries.map((e: any) => e.action)).toEqual(["rider_application_approved", "vendor_application_approved"]);
  });
});
