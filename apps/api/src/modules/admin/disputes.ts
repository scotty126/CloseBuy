import type { PrismaClient, Order } from "@prisma/client";
import type { MonnifyClient } from "../payments/monnify.js";
import type { NotificationService } from "../notifications/service.js";
import { refundEntries, partialRefundEntries, escrowReleaseEntries, postLedgerEntries, computeEscrowSplit } from "../order/ledger.js";
import { ConfigKeys } from "../../lib/config.js";
import type { AdminDisputeFilterInput, DisputeResolveInput, NotificationType } from "@closebuy/types";

/**
 * US-A-04 — dispute resolution. Its own module, same precedent as
 * ./orders.js (own local writeTransition/notifyCustomer/notifyVendor,
 * touches prisma.order and the ledger helpers directly rather than
 * reaching into order/service.ts's private closures).
 */

export class DisputeNotFoundError extends Error {
  constructor() {
    super("Dispute not found.");
  }
}

export class DisputeAlreadyResolvedError extends Error {
  constructor() {
    super("This dispute has already been resolved.");
  }
}

export class InvalidResolutionError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export class NothingToRefundError extends Error {
  constructor() {
    super("This order was never actually charged, or has already been refunded.");
  }
}

export interface AdminDisputeServiceDeps {
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

export function createAdminDisputeService({ prisma, monnify, notifications }: AdminDisputeServiceDeps) {
  async function writeAuditLog(actorId: string, action: string, targetType: string, targetId: string, reason?: string) {
    await prisma.auditLog.create({ data: { actorId, action, targetType, targetId, reason } });
  }

  /** No-op for a guest order (brief §3.1b) — same helper shape as order/service.ts and admin/orders.ts. */
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

  async function commissionRateFor(order: Order): Promise<number> {
    return order.fulfilmentType === "pickup"
      ? ConfigKeys.commissionRatePickup(prisma)
      : ConfigKeys.commissionRateDelivery(prisma);
  }

  return {
    /** US-A-04 — the queue, oldest first (same "first opened, first handled" ordering as Applications). */
    async listDisputes(filter: AdminDisputeFilterInput) {
      const disputes = await prisma.dispute.findMany({
        where: filter.status ? { status: filter.status } : {},
        include: { order: { include: { vendor: { select: { businessName: true } } } } },
        take: filter.limit,
        ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
        orderBy: { createdAt: "asc" },
      });

      const nextCursor = disputes.length === filter.limit ? disputes[disputes.length - 1]?.id : undefined;
      return { disputes, nextCursor };
    },

    async getDispute(id: string) {
      const dispute = await prisma.dispute.findUnique({
        where: { id },
        include: { order: { include: { vendor: { select: { businessName: true } } } } },
      });
      if (!dispute) throw new DisputeNotFoundError();
      return dispute;
    },

    /**
     * US-A-04 — the dispute already put the order's escrow-release timer on
     * hold (order/service.ts's disputeOrder → queue.cancelEscrowRelease),
     * so every branch here is responsible for moving the order to a real
     * terminal outcome itself; none of them can rely on that timer firing
     * later.
     */
    async resolveDispute(adminUserId: string, disputeId: string, input: DisputeResolveInput) {
      const dispute = await prisma.dispute.findUnique({ where: { id: disputeId } });
      if (!dispute) throw new DisputeNotFoundError();
      if (dispute.status !== "open") throw new DisputeAlreadyResolvedError();

      const order = await prisma.order.findUniqueOrThrow({ where: { id: dispute.orderId } });
      const payment = await prisma.payment.findUnique({ where: { orderId: order.id } });
      const fromStatus = order.status;

      if (input.resolution === "full_refund") {
        if (!payment || payment.status !== "succeeded" || payment.gateway === "cash") throw new NothingToRefundError();

        await postLedgerEntries(prisma, refundEntries(order.id, order.totalMinor));
        await monnify.refund({
          transactionReference: payment.gatewayReference,
          refundReference: `dispute-full-refund-${order.id}`,
          amountMinor: order.totalMinor,
          reason: input.reason,
        });
        await prisma.payment.update({ where: { id: payment.id }, data: { status: "refunded" } });
        await prisma.order.update({ where: { id: order.id }, data: { status: "REFUNDED" } });
        await writeTransition(prisma, order.id, fromStatus, "REFUNDED", adminUserId, input.reason);
      } else if (input.resolution === "partial_refund") {
        const amountMinor = input.amountMinor!;
        if (amountMinor >= order.totalMinor) {
          throw new InvalidResolutionError("A partial refund must be less than the order total — use full_refund instead.");
        }
        if (!payment || payment.status !== "succeeded" || payment.gateway === "cash") throw new NothingToRefundError();

        // Whatever isn't refunded still releases normally — split against
        // the remaining amount, not the order's original total, and cap
        // the rider's cut at what's actually left (a very large partial
        // refund can eat into the delivery fee too).
        const releaseAmountMinor = order.totalMinor - amountMinor;
        const effectiveDeliveryFeeMinor = Math.min(order.deliveryFeeMinor, releaseAmountMinor);
        const rate = await commissionRateFor(order);
        const split = computeEscrowSplit(releaseAmountMinor, effectiveDeliveryFeeMinor, rate);

        await postLedgerEntries(prisma, partialRefundEntries(order.id, amountMinor, releaseAmountMinor, split));
        await monnify.refund({
          transactionReference: payment.gatewayReference,
          refundReference: `dispute-partial-refund-${order.id}`,
          amountMinor,
          reason: input.reason,
        });
        await prisma.payment.update({ where: { id: payment.id }, data: { status: "partially_refunded" } });
        await prisma.order.update({ where: { id: order.id }, data: { status: "COMPLETED", commissionMinor: split.commissionMinor } });
        await writeTransition(prisma, order.id, fromStatus, "COMPLETED", adminUserId, input.reason);
      } else {
        // rejected — no money moves beyond the normal escrow release this
        // order was always going to get; the dispute just delayed it.
        const rate = await commissionRateFor(order);
        const split = computeEscrowSplit(order.totalMinor, order.deliveryFeeMinor, rate);

        await postLedgerEntries(prisma, escrowReleaseEntries(order.id, order.totalMinor, split));
        await prisma.order.update({ where: { id: order.id }, data: { status: "COMPLETED", commissionMinor: split.commissionMinor } });
        await writeTransition(prisma, order.id, fromStatus, "COMPLETED", adminUserId, input.reason);
      }

      const resolved = await prisma.dispute.update({
        where: { id: disputeId },
        data: { status: "resolved", resolution: input.resolution, resolvedBy: adminUserId, resolvedAt: new Date() },
      });

      await writeAuditLog(adminUserId, "dispute_resolved", "dispute", disputeId, input.reason);
      const payload = { disputeId, orderId: order.id, resolution: input.resolution, reason: input.reason };
      await notifyCustomer(order, "dispute_resolved", payload);
      await notifyVendor(order, "dispute_resolved", payload);

      return resolved;
    },
  };
}

export type AdminDisputeService = ReturnType<typeof createAdminDisputeService>;
