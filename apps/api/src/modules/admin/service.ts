import type { PrismaClient } from "@prisma/client";
import type { ApplicationType, AuditLogFilterInput } from "@closebuy/types";
import type { NotificationService } from "../notifications/service.js";
import { ConfigKeys } from "../../lib/config.js";

export class ApplicationNotFoundError extends Error {
  constructor() {
    super("Application not found.");
  }
}

export class InvalidApplicationStateError extends Error {
  constructor() {
    super("This application has already been decided.");
  }
}

export interface AdminServiceDeps {
  prisma: PrismaClient;
  notifications: NotificationService;
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

/**
 * Admin — vendor/rider application vetting (US-A-01) plus the audit-log
 * search that reads what every module's own writeAuditLog already
 * produces (US-A-08). Order oversight (US-A-03) lives in ./orders.js,
 * disputes (US-A-04) in ./disputes.js, config writes (US-A-02) in
 * ./config.js, actor suspension (US-A-06) in ./actors.js, payouts in
 * ../payouts/. Still real, still not built: reconciliation, metrics
 * (M-priority, M3 — not forgotten, just genuinely lower priority than
 * the S-tagged stories above them).
 */
export function createAdminService({ prisma, notifications }: AdminServiceDeps) {
  async function writeAuditLog(actorId: string, action: string, targetType: string, targetId: string, reason?: string) {
    await prisma.auditLog.create({ data: { actorId, action, targetType, targetId, reason } });
  }

  return {
    /** US-A-01 — both application types, oldest first, merged into one queue. */
    async listPendingApplications() {
      const [vendors, riders] = await Promise.all([
        prisma.vendorProfile.findMany({ where: { status: "pending" }, include: { category: true } }),
        prisma.riderProfile.findMany({ where: { status: "pending" } }),
      ]);

      return [
        ...vendors.map((v) => ({ type: "vendor" as const, ...v })),
        ...riders.map((r) => ({ type: "rider" as const, ...r })),
      ].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    },

    /**
     * US-A-01 — approval grants the surface immediately (just flipping
     * `status`; nothing else gates a vendor going live or a rider going on
     * duty). For a vendor, also starts the Founding Vendor Program window
     * if it's currently open (brief §3.2a) — computed here, once, at
     * approval time, not re-evaluated later, so a program toggle after the
     * fact never retroactively changes an already-approved vendor's
     * window.
     */
    async approveApplication(adminUserId: string, type: ApplicationType, id: string) {
      if (type === "vendor") {
        const vendor = await prisma.vendorProfile.findUnique({ where: { id } });
        if (!vendor) throw new ApplicationNotFoundError();
        if (vendor.status !== "pending") throw new InvalidApplicationStateError();

        const [programActive, waiverMonths] = await Promise.all([
          ConfigKeys.foundingVendorProgramActive(prisma),
          ConfigKeys.foundingVendorProgramWaiverMonths(prisma),
        ]);
        const foundingVendorCommissionWaivedUntil = programActive ? addMonths(new Date(), waiverMonths) : null;

        const updated = await prisma.vendorProfile.update({
          where: { id },
          data: { status: "approved", foundingVendorCommissionWaivedUntil },
        });
        await writeAuditLog(adminUserId, "vendor_application_approved", "vendor_profile", id);
        await notifications.notify(updated.userId, "vendor_application_approved", {
          vendorId: id,
          foundingVendorCommissionWaivedUntil: foundingVendorCommissionWaivedUntil?.toISOString() ?? null,
        });
        return { type: "vendor" as const, ...updated };
      }

      const rider = await prisma.riderProfile.findUnique({ where: { id } });
      if (!rider) throw new ApplicationNotFoundError();
      if (rider.status !== "pending") throw new InvalidApplicationStateError();

      const updated = await prisma.riderProfile.update({ where: { id }, data: { status: "approved" } });
      await writeAuditLog(adminUserId, "rider_application_approved", "rider_profile", id);
      await notifications.notify(updated.userId, "rider_application_approved", { riderId: id });
      return { type: "rider" as const, ...updated };
    },

    /** US-A-01 — reason is mandatory (enforced by the Zod schema at the route), and always logged. */
    async rejectApplication(adminUserId: string, type: ApplicationType, id: string, reason: string) {
      if (type === "vendor") {
        const vendor = await prisma.vendorProfile.findUnique({ where: { id } });
        if (!vendor) throw new ApplicationNotFoundError();
        if (vendor.status !== "pending") throw new InvalidApplicationStateError();

        const updated = await prisma.vendorProfile.update({ where: { id }, data: { status: "rejected" } });
        await writeAuditLog(adminUserId, "vendor_application_rejected", "vendor_profile", id, reason);
        await notifications.notify(updated.userId, "vendor_application_rejected", { vendorId: id, reason });
        return { type: "vendor" as const, ...updated };
      }

      const rider = await prisma.riderProfile.findUnique({ where: { id } });
      if (!rider) throw new ApplicationNotFoundError();
      if (rider.status !== "pending") throw new InvalidApplicationStateError();

      const updated = await prisma.riderProfile.update({ where: { id }, data: { status: "rejected" } });
      await writeAuditLog(adminUserId, "rider_application_rejected", "rider_profile", id, reason);
      await notifications.notify(updated.userId, "rider_application_rejected", { riderId: id, reason });
      return { type: "rider" as const, ...updated };
    },

    /** US-A-08 — append-only by DB grant (data-model.md), same as ledger_entries; this is the read side, search only, no write/delete ever offered. */
    async searchAuditLog(filter: AuditLogFilterInput) {
      const entries = await prisma.auditLog.findMany({
        where: {
          ...(filter.actorId ? { actorId: filter.actorId } : {}),
          ...(filter.targetType ? { targetType: filter.targetType } : {}),
          ...(filter.targetId ? { targetId: filter.targetId } : {}),
          ...(filter.from || filter.to
            ? { createdAt: { ...(filter.from ? { gte: new Date(filter.from) } : {}), ...(filter.to ? { lte: new Date(filter.to) } : {}) } }
            : {}),
        },
        take: filter.limit,
        ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
        orderBy: { createdAt: "desc" },
      });

      const nextCursor = entries.length === filter.limit ? entries[entries.length - 1]?.id : undefined;
      return { entries, nextCursor };
    },
  };
}

export type AdminService = ReturnType<typeof createAdminService>;
