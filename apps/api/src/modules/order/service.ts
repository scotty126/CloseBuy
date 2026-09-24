import { randomInt } from "node:crypto";
import type { PrismaClient, Order } from "@prisma/client";
import type { MonnifyClient, WebhookEvent } from "../payments/monnify.js";
import { type OrderQueue, scheduleTimer } from "./jobs.js";
import type { NotificationService } from "../notifications/service.js";
import { ConfigKeys } from "../../lib/config.js";
import { isWithinServiceArea } from "../../lib/geo.js";
import { omitFields } from "../../lib/redact.js";
import { escrowHoldEntries, computeEscrowSplit, escrowReleaseEntries, refundEntries, postLedgerEntries } from "./ledger.js";
import { computeVendorBalance } from "../payouts/balance.js";
import type { CheckoutInput, RejectOrderInput, ConfirmPickupInput, RateOrderInput, DisputeOrderInput, NotificationType } from "@closebuy/types";

export class VendorUnavailableError extends Error {
  constructor(message = "This vendor isn't accepting orders right now.") {
    super(message);
  }
}
export class OutsideServiceAreaError extends Error {
  constructor(message = "Sorry, we don't deliver there yet — we're only in Riverpark for now.") {
    super(message);
  }
}
export class CartInvalidError extends Error {
  constructor(message: string) {
    super(message);
  }
}
export class OrderNotFoundError extends Error {
  constructor() {
    super("Order not found.");
  }
}
export class ForbiddenError extends Error {
  constructor() {
    super("You don't have access to this order.");
  }
}
export class InvalidOrderStateError extends Error {
  constructor(message: string) {
    super(message);
  }
}
export class InvalidCollectionCodeError extends Error {
  constructor() {
    super("That code doesn't match.");
  }
}
export class VendorProfileNotFoundError extends Error {
  constructor() {
    super("No vendor application found for this account.");
  }
}
export class DisputeAlreadyExistsError extends Error {
  constructor() {
    super("A dispute has already been opened for this order.");
  }
}

export interface AuthContext {
  sub: string;
  role: string;
}

export interface OrderServiceDeps {
  prisma: PrismaClient;
  monnify: MonnifyClient;
  queue: OrderQueue;
  notifications: NotificationService;
  customerAppUrl: string; // Monnify's redirectUrl lands here, on the tracking page
}

function generateShortCode(): string {
  return String(randomInt(100000, 999999)); // 6 digits — used for both collectionCode and deliveryCode
}

// Shared by getOrder/getOrderByTrackingToken — exactly what the tracking
// screen needs (screens-navigation.md §1.7) and nothing more: no pickup
// coordinates, no rider's own userId, just enough to render "delivered by
// [name], [phone]" or "collect from [vendor]".
const trackingInclude = {
  items: true,
  transitions: { orderBy: { createdAt: "asc" as const } },
  vendor: { select: { businessName: true, pickupLandmark: true, pickupPhone: true, logoUrl: true } },
  rider: { select: { fullName: true, user: { select: { phone: true } } } },
  // US-C-11 — lets the tracking screen show "dispute already open"/its
  // resolution instead of the report-a-problem form once one exists
  // (Dispute.orderId is @unique, so there's only ever 0 or 1).
  dispute: true,
};

export function createOrderService(deps: OrderServiceDeps) {
  const { prisma, monnify, queue, notifications } = deps;

  async function transition(
    orderId: string,
    fromStatus: string | null,
    toStatus: string,
    actorType: "customer" | "vendor" | "rider" | "admin" | "system",
    actorId: string | null,
    reason?: string,
  ) {
    await prisma.orderStateTransition.create({
      data: { orderId, fromStatus: fromStatus as any, toStatus: toStatus as any, actorType, actorId, reason },
    });
  }

  /** No-op for a guest order (brief §3.1b) — there's no User row behind it to notify at all, not a gap. */
  async function notifyCustomer(order: Pick<Order, "customerId">, type: NotificationType, payload: Record<string, unknown>) {
    if (!order.customerId) return;
    const customer = await prisma.customerProfile.findUnique({ where: { id: order.customerId } });
    if (!customer) return;
    await notifications.notify(customer.userId, type, payload);
  }

  /** Shared by the cash-on-delivery checkout path and the Monnify webhook — both converge on "order is now PAID". */
  async function markOrderPaid(orderId: string, actorType: "system") {
    const order = await prisma.order.update({ where: { id: orderId }, data: { status: "PAID" } });
    await transition(orderId, "PENDING_PAYMENT", "PAID", actorType, null);

    const acceptWindowMinutes = await ConfigKeys.vendorAcceptWindowMinutes(prisma);
    await scheduleTimer("auto-reject", orderId, () => queue.scheduleAutoReject(orderId, acceptWindowMinutes));

    const vendor = await prisma.vendorProfile.findUnique({ where: { id: order.vendorId } });
    if (vendor) {
      await notifications.notify(vendor.userId, "order_paid", { orderId: order.id, totalMinor: order.totalMinor });
    }

    return order;
  }

  return {
    /**
     * US-C-06 — the cart is client-side (brief §3.1b); this is the one
     * place the server stops trusting it. Re-validates price, stock and
     * vendor availability against the database, never the client's copy.
     */
    async checkout(input: CheckoutInput, auth: AuthContext | null, idempotencyKey: string) {
      // Idempotent replay — the same key returns the same order rather
      // than creating a second one (api-contracts.md's Idempotency-Key).
      const existingPayment = await prisma.payment.findUnique({ where: { gatewayReference: idempotencyKey } });
      if (existingPayment) {
        const order = await prisma.order.findUniqueOrThrow({ where: { id: existingPayment.orderId } });
        return { order, trackingToken: order.trackingToken, replay: true as const };
      }

      const vendor = await prisma.vendorProfile.findUnique({ where: { id: input.vendorId } });
      if (!vendor || vendor.status !== "approved") throw new VendorUnavailableError();
      if (!input.scheduledFor && !vendor.isOpen) throw new VendorUnavailableError("This vendor is currently closed.");
      if (input.fulfilmentType === "pickup" && !vendor.supportsPickup) {
        throw new VendorUnavailableError("This vendor doesn't offer pickup.");
      }
      if (
        input.fulfilmentType === "delivery" &&
        !(await isWithinServiceArea(prisma, input.deliveryLat!, input.deliveryLng!))
      ) {
        throw new OutsideServiceAreaError(); // US-C-05 — brief §2a, launch is Riverpark only
      }

      const products = await prisma.product.findMany({
        where: { id: { in: input.items.map((i) => i.productId) } },
      });
      const byId = new Map(products.map((p) => [p.id, p]));

      let subtotalMinor = 0;
      const orderItemsData = input.items.map((item) => {
        const product = byId.get(item.productId);
        if (!product || product.vendorId !== input.vendorId || !product.isActive) {
          throw new CartInvalidError(`Product ${item.productId} is no longer available from this vendor.`);
        }
        if (product.stock < item.quantity) {
          throw new CartInvalidError(`"${product.name}" doesn't have enough stock.`);
        }
        subtotalMinor += product.priceMinor * item.quantity;
        return {
          productId: product.id,
          nameSnapshot: product.name,
          priceMinorSnapshot: product.priceMinor,
          quantity: item.quantity,
        };
      });

      const deliveryFeeMinor = input.fulfilmentType === "pickup" ? 0 : await ConfigKeys.flatDeliveryFeeMinor(prisma);
      const totalMinor = subtotalMinor + deliveryFeeMinor;

      const customer =
        auth?.role === "customer" ? await prisma.customerProfile.findUnique({ where: { userId: auth.sub } }) : null;

      const order = await prisma.$transaction(async (tx) => {
        const created = await tx.order.create({
          data: {
            customerId: customer?.id,
            vendorId: input.vendorId,
            contactPhone: input.contactPhone,
            alternateContactPhone: input.alternateContactPhone,
            fulfilmentType: input.fulfilmentType,
            scheduledFor: input.scheduledFor ? new Date(input.scheduledFor) : null,
            addressId: input.addressId,
            deliveryLat: input.deliveryLat,
            deliveryLng: input.deliveryLng,
            deliveryLandmark: input.deliveryLandmark,
            status: "PENDING_PAYMENT",
            paymentMethod: input.paymentMethod,
            subtotalMinor,
            deliveryFeeMinor,
            discountMinor: 0,
            totalMinor,
            items: { create: orderItemsData },
          },
        });
        await tx.orderStateTransition.create({
          data: {
            orderId: created.id,
            fromStatus: null,
            toStatus: "PENDING_PAYMENT",
            actorType: "customer", // a guest is still the customer actor, just an unauthenticated one
            actorId: auth?.sub ?? null,
          },
        });
        return created;
      });

      if (input.paymentMethod === "cash_on_delivery") {
        // No gateway involved — the Payment row exists purely for the
        // idempotency mechanism, and carries no real money yet. Actual
        // cash movement is tracked at delivery time (rider_cash_float),
        // which belongs to the Dispatch module, not built yet.
        await prisma.payment.create({
          data: { orderId: order.id, gateway: "cash", gatewayReference: idempotencyKey, amountMinor: totalMinor, status: "succeeded" },
        });
        const paid = await markOrderPaid(order.id, "system");
        return { order: paid, trackingToken: order.trackingToken, replay: false as const };
      }

      await prisma.payment.create({
        data: { orderId: order.id, gateway: "monnify", gatewayReference: idempotencyKey, amountMinor: totalMinor, status: "pending" },
      });

      const email = input.email ?? (auth ? (await prisma.user.findUnique({ where: { id: auth.sub } }))?.email : undefined) ?? `guest-${order.id}@closebuy.app`;

      const { checkoutUrl } = await monnify.initializeTransaction({
        amountMinor: totalMinor,
        customerName: "CloseBuy customer",
        customerEmail: email,
        paymentReference: idempotencyKey,
        paymentDescription: `CloseBuy order ${order.id}`,
        redirectUrl: `${deps.customerAppUrl}/orders/track/${order.trackingToken}`,
      });

      return { order, checkoutUrl, trackingToken: order.trackingToken, replay: false as const };
    },

    /**
     * Monnify webhook — signature-verified by the caller (routes.ts, since
     * it needs the raw body before Fastify parses it). Idempotent on
     * gatewayReference: a duplicate notification for an already-succeeded
     * payment is a no-op, per Monnify's own documented retry behaviour.
     */
    async handleMonnifyWebhook(event: WebhookEvent) {
      if (event.eventType !== "SUCCESSFUL_TRANSACTION") return; // ignore anything we don't act on

      const payment = await prisma.payment.findUnique({ where: { gatewayReference: event.eventData.paymentReference } });
      if (!payment) return; // not one of ours, or already-deleted test data — ignore, don't throw
      if (payment.status === "succeeded") return; // idempotent replay

      await prisma.payment.update({ where: { id: payment.id }, data: { status: "succeeded" } });
      const order = await markOrderPaid(payment.orderId, "system");

      await postLedgerEntries(prisma, escrowHoldEntries(order.id, order.totalMinor));
    },

    async getOrder(orderId: string, auth: AuthContext) {
      const order = await prisma.order.findUnique({ where: { id: orderId }, include: trackingInclude });
      if (!order) throw new OrderNotFoundError();

      const owns =
        (auth.role === "customer" && order.customerId && (await prisma.customerProfile.findUnique({ where: { userId: auth.sub } }))?.id === order.customerId) ||
        (auth.role === "vendor" && (await prisma.vendorProfile.findUnique({ where: { userId: auth.sub } }))?.id === order.vendorId) ||
        (auth.role === "rider" && order.riderId && (await prisma.riderProfile.findUnique({ where: { userId: auth.sub } }))?.id === order.riderId);
      if (!owns) throw new ForbiddenError();

      // Both codes exist so the right party can be told them in person —
      // reading either back from your own screen defeats that (see the
      // schema comment on Order.collectionCode/deliveryCode). A vendor
      // still needs to see collectionCode (they're the one reading it
      // aloud); a rider needs neither, ever.
      if (auth.role === "rider") return omitFields(order, ["collectionCode", "deliveryCode"]);
      if (auth.role === "vendor") return omitFields(order, ["deliveryCode"]);
      return order;
    },

    /**
     * US-C-06a — the only way a guest ever reaches their order again; also
     * works for a signed-in customer sharing the link. Never a phone/email
     * lookup. Includes vendor/rider contact details (screens-navigation.md
     * §1.7 — "a delivery order shows the assigned rider's name and phone
     * once assigned") since anyone holding the tracking token is already
     * meant to see this order's full status, same as a guest with the link.
     */
    async getOrderByTrackingToken(trackingToken: string) {
      const order = await prisma.order.findUnique({ where: { trackingToken }, include: trackingInclude });
      if (!order) throw new OrderNotFoundError();
      return order;
    },

    /** US-C-09 */
    async listCustomerOrders(userId: string) {
      const customer = await prisma.customerProfile.findUnique({ where: { userId } });
      if (!customer) return [];
      return prisma.order.findMany({ where: { customerId: customer.id }, orderBy: { createdAt: "desc" } });
    },

    /**
     * US-V-05 — the vendor's own order queue. One flat, newest-first list;
     * the New/In Progress/Scheduled/History tabs screens-navigation.md
     * §2.1 describes are bucketed client-side from this, not four separate
     * queries — the bucketing rule (scheduled-vs-not, then status) is a
     * display concern, not a different dataset.
     */
    async listVendorOrders(vendorUserId: string) {
      const vendor = await prisma.vendorProfile.findUnique({ where: { userId: vendorUserId } });
      if (!vendor) throw new VendorProfileNotFoundError();
      const orders = await prisma.order.findMany({
        where: { vendorId: vendor.id },
        include: { items: true, transitions: { orderBy: { createdAt: "asc" } } },
        orderBy: { createdAt: "desc" },
      });
      // collectionCode stays — the vendor generates it and reads it aloud
      // to the rider (US-V-06). deliveryCode is the customer's to the
      // rider; the vendor has no part in that handoff.
      return orders.map((o) => omitFields(o, ["deliveryCode"]));
    },

    /**
     * US-V-07 — running balance + per-order breakdown. A vendor is only
     * ever paid for the goods, never the delivery fee (brief §3.2a — that
     * passes to the rider); `commissionMinor` is exact for a `COMPLETED`
     * order (computed once at `releaseEscrow`) but a gross estimate for
     * anything still in flight, since the real split isn't final until
     * escrow actually releases — the two are deliberately not blended
     * into one number.
     */
    async getVendorEarnings(vendorUserId: string) {
      const vendor = await prisma.vendorProfile.findUnique({ where: { userId: vendorUserId } });
      if (!vendor) throw new VendorProfileNotFoundError();

      const orders = await prisma.order.findMany({ where: { vendorId: vendor.id }, orderBy: { updatedAt: "desc" } });
      const cleared = orders.filter((o) => o.status === "COMPLETED");
      const pendingStatuses = ["PAID", "PREPARING", "READY_FOR_PICKUP", "RIDER_ASSIGNED", "IN_TRANSIT", "DELIVERED"];
      const pending = orders.filter((o) => pendingStatuses.includes(o.status));

      // clearedMinor/pendingMinor below answer "how much have I sold" (per
      // order, gross of any payout) — a genuinely different question from
      // "what can I withdraw right now", which has to net out money
      // already requested/paid (payouts/balance.ts's the one place that
      // math happens, so this and the payouts module can't drift apart).
      const balance = await computeVendorBalance(prisma, vendor.id);

      return {
        clearedMinor: cleared.reduce((sum, o) => sum + (o.subtotalMinor - o.commissionMinor), 0),
        pendingMinor: pending.reduce((sum, o) => sum + o.subtotalMinor, 0), // gross estimate — see docstring
        availableToWithdrawMinor: balance.availableToWithdrawMinor,
        foundingVendorCommissionWaivedUntil: vendor.foundingVendorCommissionWaivedUntil,
        orders: cleared.slice(0, 50).map((o) => ({
          orderId: o.id,
          grossMinor: o.subtotalMinor,
          commissionMinor: o.commissionMinor,
          netMinor: o.subtotalMinor - o.commissionMinor,
          completedAt: o.updatedAt,
        })),
      };
    },

    /** US-C-08 — self-service only while PAID; anything further along needs a support/dispute path. */
    async cancelOrder(auth: AuthContext, orderId: string) {
      const order = await this.getOrder(orderId, auth);
      if (order.status !== "PAID") {
        throw new InvalidOrderStateError(`Cannot self-service cancel an order in status ${order.status}.`);
      }

      await queue.cancelAutoReject(orderId);
      await prisma.order.update({ where: { id: orderId }, data: { status: "CANCELLED" } });
      await transition(orderId, "PAID", "CANCELLED", "customer", auth.sub, "Customer cancelled");
      await refundIfPaid(order);
      await prisma.order.update({ where: { id: orderId }, data: { status: "REFUNDED" } });
      await transition(orderId, "CANCELLED", "REFUNDED", "system", null);
    },

    /** US-V-05 */
    async acceptOrder(vendorUserId: string, orderId: string) {
      const order = await getOwnedVendorOrder(vendorUserId, orderId);
      if (order.status !== "PAID") throw new InvalidOrderStateError(`Cannot accept an order in status ${order.status}.`);

      // Atomic conditional decrement per item — data-model.md §6 invariant
      // 4. If any item's stock has run out since checkout (another order
      // consumed it while this one waited in the accept window), the
      // whole accept fails and the vendor sees why, rather than silently
      // overselling.
      const items = await prisma.orderItem.findMany({ where: { orderId } });
      await prisma.$transaction(async (tx) => {
        for (const item of items) {
          const { count } = await tx.product.updateMany({
            where: { id: item.productId, stock: { gte: item.quantity } },
            data: { stock: { decrement: item.quantity } },
          });
          if (count === 0) {
            throw new InvalidOrderStateError(`Not enough stock left for "${item.nameSnapshot}" to accept this order.`);
          }
        }
        await tx.order.update({ where: { id: orderId }, data: { status: "PREPARING" } });
      });

      await queue.cancelAutoReject(orderId);
      await transition(orderId, "PAID", "PREPARING", "vendor", vendorUserId);
      await notifyCustomer(order, "order_accepted", { orderId });
    },

    /** US-V-05 — full refund, mandatory reason. */
    async rejectOrder(vendorUserId: string, orderId: string, input: RejectOrderInput) {
      const order = await getOwnedVendorOrder(vendorUserId, orderId);
      if (order.status !== "PAID") throw new InvalidOrderStateError(`Cannot reject an order in status ${order.status}.`);

      await queue.cancelAutoReject(orderId);
      await prisma.order.update({ where: { id: orderId }, data: { status: "CANCELLED" } });
      await transition(orderId, "PAID", "CANCELLED", "vendor", vendorUserId, input.reason);
      await refundIfPaid(order);
      await prisma.order.update({ where: { id: orderId }, data: { status: "REFUNDED" } });
      await transition(orderId, "CANCELLED", "REFUNDED", "system", null);

      await prisma.vendorProfile.update({
        where: { id: order.vendorId },
        data: { reliabilityScore: { decrement: 0.1 } }, // crude for now — a real scoring model is a later refinement, not guessed at further here
      });
      await notifyCustomer(order, "order_rejected", { orderId, reason: input.reason });
    },

    /** US-V-06 — issues the collection code either party (customer or rider) will need to present. */
    async markReady(vendorUserId: string, orderId: string) {
      const order = await getOwnedVendorOrder(vendorUserId, orderId);
      if (order.status !== "PREPARING") throw new InvalidOrderStateError(`Cannot mark ready an order in status ${order.status}.`);

      const collectionCode = generateShortCode();
      // Delivery orders get a second code here too — the customer reads
      // *this* one to the rider at drop-off (US-R-05), the second of two
      // handoff checks. Generated now rather than later so it's ready
      // whenever the customer first looks, no matter when a rider claims
      // the job.
      const deliveryCode = order.fulfilmentType === "delivery" ? generateShortCode() : null;
      await prisma.order.update({ where: { id: orderId }, data: { status: "READY_FOR_PICKUP", collectionCode, deliveryCode } });
      await transition(orderId, "PREPARING", "READY_FOR_PICKUP", "vendor", vendorUserId);

      // Pickup: collectionCode is what the customer shows at the counter
      // (US-C-07). Delivery: deliveryCode is what the customer reads to
      // the rider at their door — collectionCode itself never reaches the
      // customer (or Dispatch) via notification; the vendor's own screen
      // is where that one lives (US-V-06).
      await notifyCustomer(
        order,
        "order_ready_for_pickup",
        order.fulfilmentType === "pickup" ? { orderId, collectionCode } : { orderId, deliveryCode },
      );
    },

    /** US-V-06/US-C-07 — pickup orders only; the vendor confirms the code the customer shows. */
    async confirmCustomerPickup(vendorUserId: string, orderId: string, input: ConfirmPickupInput) {
      const order = await getOwnedVendorOrder(vendorUserId, orderId);
      if (order.fulfilmentType !== "pickup") throw new InvalidOrderStateError("This isn't a pickup order.");
      if (order.status !== "READY_FOR_PICKUP") throw new InvalidOrderStateError(`Cannot confirm collection for an order in status ${order.status}.`);
      if (order.collectionCode !== input.code) throw new InvalidCollectionCodeError();

      await prisma.order.update({ where: { id: orderId }, data: { status: "DELIVERED" } });
      await transition(orderId, "READY_FOR_PICKUP", "DELIVERED", "vendor", vendorUserId);

      const escrowReleaseWindowHours = await ConfigKeys.escrowReleaseWindowHours(prisma);
      await scheduleTimer("escrow-release", orderId, () => queue.scheduleEscrowRelease(orderId, escrowReleaseWindowHours));
    },

    async rateOrder(orderId: string, input: RateOrderInput, customerId: string | null) {
      const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      if (order.status !== "COMPLETED") throw new InvalidOrderStateError("Can only rate a completed order.");

      const targetId = input.targetType === "vendor" ? order.vendorId : order.riderId;
      if (!targetId) throw new InvalidOrderStateError(`This order has no ${input.targetType} to rate.`);

      return prisma.rating.create({
        data: {
          orderId,
          customerId,
          targetType: input.targetType,
          targetId,
          score: input.score,
          comment: input.comment,
          editedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
    },

    async disputeOrder(orderId: string, input: DisputeOrderInput, customerId: string | null) {
      const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      const existing = await prisma.dispute.findUnique({ where: { orderId } });
      if (existing) throw new DisputeAlreadyExistsError();

      const deliveredAt = (await prisma.orderStateTransition.findFirst({ where: { orderId, toStatus: "DELIVERED" } }))?.createdAt;
      if (!deliveredAt || Date.now() - deliveredAt.getTime() > 48 * 60 * 60 * 1000) {
        throw new InvalidOrderStateError("Disputes must be opened within 48 hours of delivery.");
      }

      await queue.cancelEscrowRelease(orderId); // US-C-11 — holds the pending release
      return prisma.dispute.create({
        data: { orderId, customerId, reason: input.reason, evidence: input.evidence ?? [] },
      });
    },

    // ── Timer-triggered, system actor — called by the BullMQ worker (jobs.ts), never directly by a route. ──

    /** US-V-05 — the vendor never responded within the accept window. */
    async autoRejectOrder(orderId: string) {
      const order = await prisma.order.findUnique({ where: { id: orderId } });
      if (!order || order.status !== "PAID") return; // already handled by a human in the meantime — no-op, not an error

      await prisma.order.update({ where: { id: orderId }, data: { status: "CANCELLED" } });
      await transition(orderId, "PAID", "CANCELLED", "system", null, "Vendor did not respond within the accept window");
      await refundIfPaid(order);
      await prisma.order.update({ where: { id: orderId }, data: { status: "REFUNDED" } });
      await transition(orderId, "CANCELLED", "REFUNDED", "system", null);

      await prisma.vendorProfile.update({ where: { id: order.vendorId }, data: { reliabilityScore: { decrement: 0.2 } } });
      await notifyCustomer(order, "order_auto_rejected", { orderId });
    },

    /** brief §4 / US-C-11 — no dispute was opened within the window; escrow releases to vendor + rider + platform. */
    async releaseEscrow(orderId: string) {
      const order = await prisma.order.findUnique({ where: { id: orderId } });
      if (!order || order.status !== "DELIVERED") return; // a dispute already moved this elsewhere — no-op

      const existingDispute = await prisma.dispute.findUnique({ where: { orderId } });
      if (existingDispute) return; // defensive — cancelEscrowRelease should already have prevented this job from firing

      const rate =
        order.fulfilmentType === "pickup"
          ? await ConfigKeys.commissionRatePickup(prisma)
          : await ConfigKeys.commissionRateDelivery(prisma);
      const split = computeEscrowSplit(order.totalMinor, order.deliveryFeeMinor, rate);

      await postLedgerEntries(prisma, escrowReleaseEntries(orderId, order.totalMinor, split));
      await prisma.order.update({ where: { id: orderId }, data: { status: "COMPLETED", commissionMinor: split.commissionMinor } });
      await transition(orderId, "DELIVERED", "COMPLETED", "system", null, "Escrow released — no dispute within the window");
    },
  };

  async function getOwnedVendorOrder(vendorUserId: string, orderId: string) {
    const vendor = await prisma.vendorProfile.findUnique({ where: { userId: vendorUserId } });
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!vendor || !order || order.vendorId !== vendor.id) throw new OrderNotFoundError();
    return order;
  }

  async function refundIfPaid(order: { id: string; paymentMethod: string; totalMinor: number }) {
    const payment = await prisma.payment.findUnique({ where: { orderId: order.id } });
    if (!payment || payment.status !== "succeeded" || payment.gateway === "cash") {
      return; // nothing was ever actually charged — nothing to refund
    }

    await postLedgerEntries(prisma, refundEntries(order.id, order.totalMinor));
    await monnify.refund({
      transactionReference: payment.gatewayReference,
      refundReference: `refund-${order.id}`,
      amountMinor: order.totalMinor,
      reason: "Order cancelled",
    });
    await prisma.payment.update({ where: { id: payment.id }, data: { status: "refunded" } });
  }
}

export type OrderService = ReturnType<typeof createOrderService>;
