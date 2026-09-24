import type { PrismaClient, Order } from "@prisma/client";
import type { MonnifyClient } from "../payments/monnify.js";
import type { NotificationService } from "../notifications/service.js";
import { refundEntries, postLedgerEntries } from "../order/ledger.js";
import type { AdminOrderFilterInput } from "@closebuy/types";
import type { NotificationType } from "@closebuy/types";

/**
 * US-A-03 — order oversight. Deliberately its own module, not added to
 * order/service.ts's `createOrderService` or grafted onto
 * admin/service.ts's application-vetting concern — this mirrors
 * dispatch/service.ts's existing precedent (its own local
 * `writeTransition`/`notifyCustomer`, touching `prisma.order` directly
 * rather than reaching into order/service.ts's private closures) rather
 * than introducing a new cross-module sharing pattern for this one case.
 * ./disputes.js and ./actors.js repeat the same shape for US-A-04/US-A-06.
 */

export class OrderNotFoundError extends Error {
  constructor() {
    super("Order not found.");
  }
}

export class InvalidOrderStateError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export class NoRiderAssignedError extends Error {
  constructor() {
    super("This order has no rider assigned to reassign.");
  }
}

export class NothingToRefundError extends Error {
  constructor() {
    super("This order was never actually charged, or has already been refunded.");
  }
}

export interface AdminOrderServiceDeps {
  prisma: PrismaClient;
  monnify: MonnifyClient;
  notifications: NotificationService;
}

async function writeTransition(
  prisma: PrismaClient,
  orderId: string,
  fromStatus: string,
  toStatus: string,
  actorId: string,
  reason?: string,
) {
  await prisma.orderStateTransition.create({
    data: { orderId, fromStatus: fromStatus as any, toStatus: toStatus as any, actorType: "admin", actorId, reason },
  });
}

const NON_TERMINAL_STATUSES = [
  "PAID",
  "PREPARING",
  "READY_FOR_PICKUP",
  "RIDER_ASSIGNED",
  "IN_TRANSIT",
  "DELIVERED",
] as const;

export function createAdminOrderService({ prisma, monnify, notifications }: AdminOrderServiceDeps) {
  async function writeAuditLog(actorId: string, action: string, targetType: string, targetId: string, reason?: string) {
    await prisma.auditLog.create({ data: { actorId, action, targetType, targetId, reason } });
  }

  /** No-op for a guest order (brief §3.1b) — same helper shape as order/service.ts and dispatch/service.ts. */
  async function notifyCustomer(order: Pick<Order, "customerId">, type: NotificationType, payload: Record<string, unknown>) {
    if (!order.customerId) return;
    const customer = await prisma.customerProfile.findUnique({ where: { id: order.customerId } });
    if (!customer) return;
    await notifications.notify(customer.userId, type, payload);
  }

  async function notifyVendor(order: Pick<Order, "vendorId">, type: NotificationType, payload: Record<string, unknown>) {
    const vendor = await prisma.vendorProfile.findUnique({ where: { id: order.vendorId } });
    if (!vendor) return;
    await notifications.notify(vendor.userId, type, payload);
  }

  /** Same money-movement as order/service.ts's refundIfPaid — duplicated deliberately, not imported (see module docstring). */
  async function refundIfPossible(order: Order, refundReferencePrefix: string) {
    const payment = await prisma.payment.findUnique({ where: { orderId: order.id } });
    if (!payment || payment.status !== "succeeded" || payment.gateway === "cash") {
      throw new NothingToRefundError();
    }

    await postLedgerEntries(prisma, refundEntries(order.id, order.totalMinor));
    await monnify.refund({
      transactionReference: payment.gatewayReference,
      refundReference: `${refundReferencePrefix}-${order.id}`,
      amountMinor: order.totalMinor,
      reason: "Admin-initiated refund",
    });
    await prisma.payment.update({ where: { id: payment.id }, data: { status: "refunded" } });
  }

  return {
    /** US-A-03 — full list, filterable, newest first. */
    async listOrders(filter: AdminOrderFilterInput) {
      const orders = await prisma.order.findMany({
        where: {
          ...(filter.status ? { status: filter.status } : {}),
          ...(filter.vendorId ? { vendorId: filter.vendorId } : {}),
          ...(filter.riderId ? { riderId: filter.riderId } : {}),
          ...(filter.fulfilmentType ? { fulfilmentType: filter.fulfilmentType } : {}),
          ...(filter.from || filter.to
            ? { createdAt: { ...(filter.from ? { gte: new Date(filter.from) } : {}), ...(filter.to ? { lte: new Date(filter.to) } : {}) } }
            : {}),
        },
        include: { vendor: { select: { businessName: true } }, rider: { select: { fullName: true } } },
        take: filter.limit,
        ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
        orderBy: { createdAt: "desc" },
      });

      const nextCursor = orders.length === filter.limit ? orders[orders.length - 1]?.id : undefined;
      return { orders, nextCursor };
    },

    /** US-A-03 — full detail, including its complete append-only transition history. No redaction: an operator sees everything a customer/vendor/rider individually can't. */
    async getOrder(orderId: string) {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
          items: true,
          vendor: { select: { businessName: true, pickupLandmark: true, pickupPhone: true, logoUrl: true } },
          rider: { select: { fullName: true, user: { select: { phone: true } } } },
          transitions: { orderBy: { createdAt: "asc" } },
        },
      });
      if (!order) throw new OrderNotFoundError();
      return order;
    },

    /**
     * US-A-03 — doesn't hand the job to a specific replacement rider; it
     * clears the current one and reverts to READY_FOR_PICKUP, the exact
     * same state dispatch/service.ts's listOpenJobs already queries for
     * (`status: "READY_FOR_PICKUP", riderId: null`) — so the job re-enters
     * the normal open-jobs pool for any on-duty rider to claim, rather
     * than this endpoint needing its own rider-picker and bypassing the
     * real claim flow.
     */
    async reassignRider(adminUserId: string, orderId: string, reason: string) {
      const order = await prisma.order.findUnique({ where: { id: orderId } });
      if (!order) throw new OrderNotFoundError();
      if (!order.riderId) throw new NoRiderAssignedError();
      if (!["RIDER_ASSIGNED", "IN_TRANSIT"].includes(order.status)) {
        throw new InvalidOrderStateError(`Cannot reassign an order in status ${order.status}.`);
      }

      const previousRider = await prisma.riderProfile.findUnique({ where: { id: order.riderId } });
      const updated = await prisma.order.update({
        where: { id: orderId },
        data: { riderId: null, status: "READY_FOR_PICKUP" },
      });
      await writeTransition(prisma, orderId, order.status, "READY_FOR_PICKUP", adminUserId, reason);
      await writeAuditLog(adminUserId, "order_reassigned", "order", orderId, reason);

      if (previousRider) await notifications.notify(previousRider.userId, "order_reassigned", { orderId, reason });
      return updated;
    },

    /** US-A-03 — stops the order outright; refunds if anything was actually charged. Allowed from any non-terminal status. */
    async forceCancelOrder(adminUserId: string, orderId: string, reason: string) {
      const order = await prisma.order.findUnique({ where: { id: orderId } });
      if (!order) throw new OrderNotFoundError();
      if (!NON_TERMINAL_STATUSES.includes(order.status as (typeof NON_TERMINAL_STATUSES)[number])) {
        throw new InvalidOrderStateError(`Cannot force-cancel an order already in status ${order.status}.`);
      }

      const fromStatus = order.status;
      await prisma.order.update({ where: { id: orderId }, data: { status: "CANCELLED" } });
      await writeTransition(prisma, orderId, fromStatus, "CANCELLED", adminUserId, reason);

      try {
        await refundIfPossible(order, "admin-cancel-refund");
        await prisma.order.update({ where: { id: orderId }, data: { status: "REFUNDED" } });
        await writeTransition(prisma, orderId, "CANCELLED", "REFUNDED", adminUserId);
      } catch (err) {
        if (!(err instanceof NothingToRefundError)) throw err;
        // Nothing was ever actually charged (still PENDING_PAYMENT never
        // reached, or cash order) — cancelling is the whole action, no
        // refund step needed. Stays CANCELLED, not an error case.
      }

      await writeAuditLog(adminUserId, "order_force_cancelled", "order", orderId, reason);
      await notifyCustomer(order, "order_force_cancelled", { orderId, reason });
      await notifyVendor(order, "order_force_cancelled", { orderId, reason });

      return prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    },

    /**
     * US-A-03 — a pure financial correction, deliberately distinct from
     * force-cancel: the order's own fulfilment status is left untouched
     * (still `DELIVERED`, still `IN_TRANSIT`, whatever it was), matching
     * api-contracts.md's description ("writes the same ledger-reversal
     * pattern as a normal refund" — a money action, not a state-machine
     * one). Use this for a goodwill/partial-issue refund where the order
     * itself should still complete normally; use force-cancel when the
     * order itself needs to stop.
     */
    async forceRefundOrder(adminUserId: string, orderId: string, reason: string) {
      const order = await prisma.order.findUnique({ where: { id: orderId } });
      if (!order) throw new OrderNotFoundError();

      await refundIfPossible(order, "admin-refund");
      await writeAuditLog(adminUserId, "order_force_refunded", "order", orderId, reason);
      await notifyCustomer(order, "order_force_refunded", { orderId, reason });

      return order;
    },
  };
}

export type AdminOrderService = ReturnType<typeof createAdminOrderService>;
