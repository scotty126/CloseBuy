import type { PrismaClient } from "@prisma/client";
import type { NotificationService } from "../notifications/service.js";

/**
 * US-A-06 — suspend/unsuspend a vendor or rider. `status` already gates
 * new orders (order/service.ts: `vendor.status !== "approved"` throws
 * VendorUnavailableError) and new job offers (dispatch/service.ts: same
 * check on RiderProfile) — flipping it to "suspended" is the whole
 * enforcement mechanism, nothing else to wire up there. This module is
 * just the admin-facing read/write around that flip: list, suspend
 * (with the actor's in-flight orders surfaced, not auto-cancelled — the
 * story's own acceptance criterion), and the reversal.
 */

export class ActorNotFoundError extends Error {
  constructor() {
    super("Vendor or rider not found.");
  }
}

export class InvalidActorStateError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export interface AdminActorServiceDeps {
  prisma: PrismaClient;
  notifications: NotificationService;
}

// Same list as admin/orders.ts's NON_TERMINAL_STATUSES — duplicated
// deliberately (each module owns its own Prisma access, established
// precedent, see CLAUDE.md), not imported.
const NON_TERMINAL_STATUSES = [
  "PAID",
  "PREPARING",
  "READY_FOR_PICKUP",
  "RIDER_ASSIGNED",
  "IN_TRANSIT",
  "DELIVERED",
] as const;

export function createAdminActorService({ prisma, notifications }: AdminActorServiceDeps) {
  async function writeAuditLog(actorId: string, action: string, targetType: string, targetId: string, reason?: string) {
    await prisma.auditLog.create({ data: { actorId, action, targetType, targetId, reason } });
  }

  return {
    async listVendors() {
      return prisma.vendorProfile.findMany({ include: { category: true }, orderBy: { createdAt: "desc" } });
    },

    async listRiders() {
      return prisma.riderProfile.findMany({ orderBy: { createdAt: "desc" } });
    },

    async suspendVendor(adminUserId: string, vendorId: string, reason: string) {
      const vendor = await prisma.vendorProfile.findUnique({ where: { id: vendorId }, include: { category: true } });
      if (!vendor) throw new ActorNotFoundError();
      if (vendor.status !== "approved") throw new InvalidActorStateError(`Cannot suspend a vendor in status ${vendor.status}.`);

      const updated = await prisma.vendorProfile.update({
        where: { id: vendorId },
        data: { status: "suspended" },
        include: { category: true },
      });
      await writeAuditLog(adminUserId, "vendor_suspended", "vendor_profile", vendorId, reason);
      await notifications.notify(updated.userId, "vendor_suspended", { vendorId, reason });

      const inFlightOrders = await prisma.order.findMany({
        where: { vendorId, status: { in: [...NON_TERMINAL_STATUSES] } },
        include: { vendor: { select: { businessName: true } }, rider: { select: { fullName: true } } },
        orderBy: { createdAt: "desc" },
      });
      return { vendor: updated, inFlightOrders };
    },

    async unsuspendVendor(adminUserId: string, vendorId: string, reason: string) {
      const vendor = await prisma.vendorProfile.findUnique({ where: { id: vendorId } });
      if (!vendor) throw new ActorNotFoundError();
      if (vendor.status !== "suspended") throw new InvalidActorStateError(`Cannot unsuspend a vendor in status ${vendor.status}.`);

      const updated = await prisma.vendorProfile.update({
        where: { id: vendorId },
        data: { status: "approved" },
        include: { category: true },
      });
      await writeAuditLog(adminUserId, "vendor_unsuspended", "vendor_profile", vendorId, reason);
      await notifications.notify(updated.userId, "vendor_unsuspended", { vendorId, reason });
      return updated;
    },

    async suspendRider(adminUserId: string, riderId: string, reason: string) {
      const rider = await prisma.riderProfile.findUnique({ where: { id: riderId } });
      if (!rider) throw new ActorNotFoundError();
      if (rider.status !== "approved") throw new InvalidActorStateError(`Cannot suspend a rider in status ${rider.status}.`);

      // A suspended rider shouldn't stay findable in the open-jobs pool
      // (dispatch/service.ts's onDuty query) even for the instant before
      // they'd next toggle off duty themselves.
      const updated = await prisma.riderProfile.update({
        where: { id: riderId },
        data: { status: "suspended", onDuty: false },
      });
      await writeAuditLog(adminUserId, "rider_suspended", "rider_profile", riderId, reason);
      await notifications.notify(updated.userId, "rider_suspended", { riderId, reason });

      const inFlightOrders = await prisma.order.findMany({
        where: { riderId, status: { in: [...NON_TERMINAL_STATUSES] } },
        include: { vendor: { select: { businessName: true } }, rider: { select: { fullName: true } } },
        orderBy: { createdAt: "desc" },
      });
      return { rider: updated, inFlightOrders };
    },

    async unsuspendRider(adminUserId: string, riderId: string, reason: string) {
      const rider = await prisma.riderProfile.findUnique({ where: { id: riderId } });
      if (!rider) throw new ActorNotFoundError();
      if (rider.status !== "suspended") throw new InvalidActorStateError(`Cannot unsuspend a rider in status ${rider.status}.`);

      const updated = await prisma.riderProfile.update({ where: { id: riderId }, data: { status: "approved" } });
      await writeAuditLog(adminUserId, "rider_unsuspended", "rider_profile", riderId, reason);
      await notifications.notify(updated.userId, "rider_unsuspended", { riderId, reason });
      return updated;
    },
  };
}

export type AdminActorService = ReturnType<typeof createAdminActorService>;
