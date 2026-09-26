import type { PrismaClient, Order } from "@prisma/client";
import { type OrderQueue, scheduleTimer } from "../order/jobs.js";
import type { NotificationService } from "../notifications/service.js";
import { ConfigKeys } from "../../lib/config.js";
import { omitFields } from "../../lib/redact.js";
import { codCollectionEntries, postLedgerEntries } from "../order/ledger.js";
import type {
  RiderApplicationInput,
  SetDutyInput,
  ConfirmCollectionInput,
  ConfirmDeliveryInput,
  DeliveryFailedInput,
  NotificationType,
} from "@closebuy/types";

export class RiderAlreadyExistsError extends Error {
  constructor() {
    super("This account has already submitted a rider application.");
  }
}
export class RiderNotFoundError extends Error {
  constructor() {
    super("Rider not found.");
  }
}
export class JobUnavailableError extends Error {
  constructor(message = "This job is no longer available — someone else may have already taken it.") {
    super(message);
  }
}
export class OrderNotFoundError extends Error {
  constructor() {
    super("Order not found.");
  }
}
export class InvalidCollectionCodeError extends Error {
  constructor() {
    super("That code doesn't match.");
  }
}
export class InvalidDeliveryCodeError extends Error {
  constructor() {
    super("That code doesn't match — confirm it with the customer.");
  }
}
export class CashAmountMismatchError extends Error {
  constructor(expectedMinor: number) {
    super(`Cash collected must match the order total exactly (₦${(expectedMinor / 100).toFixed(2)}).`);
  }
}
/** US-R-08 — distinct from JobUnavailableError so a rider isn't told "someone else took it" when the real reason is their own cash balance. */
export class CashFloatLimitError extends Error {
  constructor() {
    super("You're over your cash limit — hand your collected cash back to CloseBuy before taking more cash-on-delivery jobs.");
  }
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
    data: { orderId, fromStatus: fromStatus as any, toStatus: toStatus as any, actorType: "rider", actorId, reason },
  });
}

export interface DispatchServiceDeps {
  prisma: PrismaClient;
  queue: OrderQueue;
  notifications: NotificationService;
}

export function createDispatchService({ prisma, queue, notifications }: DispatchServiceDeps) {
  async function getOwnRider(userId: string) {
    const rider = await prisma.riderProfile.findUnique({ where: { userId } });
    if (!rider) throw new RiderNotFoundError();
    return rider;
  }

  /** No-op for a guest order (brief §3.1b) — there's no User row behind it to notify at all, not a gap. Same helper as order/service.ts. */
  async function notifyCustomer(order: Pick<Order, "customerId">, type: NotificationType, payload: Record<string, unknown>) {
    if (!order.customerId) return;
    const customer = await prisma.customerProfile.findUnique({ where: { id: order.customerId } });
    if (!customer) return;
    await notifications.notify(customer.userId, type, payload);
  }

  /**
   * Every order this module ever hands back to a rider goes through this
   * first. Both codes exist specifically so they have to come from
   * someone else in person (the vendor, then the customer) — a rider who
   * could just read them off their own screen wouldn't need to ask
   * either, which defeats the point of having a code at all.
   */
  function redactForRider<T extends Record<string, unknown>>(order: T): Omit<T, "collectionCode" | "deliveryCode"> {
    return omitFields(order, ["collectionCode", "deliveryCode"]);
  }

  /** US-R-08 — "exceeding a configurable float limit stops further cash-on-delivery offers": strictly greater than, the limit itself is still allowed. */
  async function isOverCashFloatLimit(cashBalanceMinor: number): Promise<boolean> {
    return cashBalanceMinor > (await ConfigKeys.riderCashFloatLimitMinor(prisma));
  }

  return {
    /** US-R-01 */
    async applyToRide(userId: string, input: RiderApplicationInput) {
      const existing = await prisma.riderProfile.findUnique({ where: { userId } });
      if (existing) throw new RiderAlreadyExistsError();

      return prisma.riderProfile.create({
        data: { userId, fullName: input.fullName, vehicleType: input.vehicleType, idDocumentUrl: input.idDocumentUrl, bankAccountRef: input.bankAccountRef, status: "pending" },
      });
    },

    async getOwnProfile(userId: string) {
      return getOwnRider(userId);
    },

    /** US-R-02 */
    async setDuty(userId: string, input: SetDutyInput) {
      const rider = await getOwnRider(userId);
      if (rider.status !== "approved" && input.onDuty) {
        throw new RiderNotFoundError(); // not approved yet — can't go on duty (reuses this error since it's the same "not a real rider yet" shape)
      }
      return prisma.riderProfile.update({ where: { userId }, data: { onDuty: input.onDuty } });
    },

    /**
     * US-R-03 — the "open pool" model Q-03 resolved on: every on-duty
     * rider sees every unclaimed job, first to accept gets it. There's no
     * separate "offer" entity (api-contracts.md originally sketched one)
     * — an unclaimed `READY_FOR_PICKUP` delivery order *is* the offer.
     * Declining one (below) is consequently a no-op against the database,
     * not tracked per-rider; a genuine "don't show me this again" would
     * need a dismissals table this doesn't have yet.
     */
    async listOpenJobs(userId: string) {
      const rider = await getOwnRider(userId);
      if (rider.status !== "approved" || !rider.onDuty) return [];

      // US-R-08 — over the float limit: cash-on-delivery jobs simply aren't
      // offered until an admin records a remittance. Prepaid ones still are.
      const overLimit = await isOverCashFloatLimit(rider.cashBalanceMinor);
      const orders = await prisma.order.findMany({
        where: {
          status: "READY_FOR_PICKUP",
          fulfilmentType: "delivery",
          riderId: null,
          ...(overLimit ? { paymentMethod: { not: "cash_on_delivery" as const } } : {}),
        },
        include: { vendor: true },
        orderBy: { updatedAt: "asc" },
      });
      return orders.map(redactForRider);
    },

    /** US-R-03 — atomic claim; two riders racing for the same job can never both win (the `updateMany` count is the guard, same pattern as US-V-04's stock decrement). */
    async claimJob(userId: string, orderId: string) {
      const rider = await getOwnRider(userId);
      if (rider.status !== "approved" || !rider.onDuty) throw new JobUnavailableError("You need to be on duty to accept jobs.");

      // US-R-08 — enforced here too, not just by hiding COD jobs in
      // listOpenJobs: the offer could have been listed before the rider
      // crossed the limit, and a client can call this endpoint directly.
      // Folded into the atomic claim's own filter so there's no read-then-
      // write gap to race through.
      const overLimit = await isOverCashFloatLimit(rider.cashBalanceMinor);
      const { count } = await prisma.order.updateMany({
        where: {
          id: orderId,
          riderId: null,
          status: "READY_FOR_PICKUP",
          fulfilmentType: "delivery",
          ...(overLimit ? { paymentMethod: { not: "cash_on_delivery" as const } } : {}),
        },
        data: { riderId: rider.id, status: "RIDER_ASSIGNED" },
      });
      if (count === 0) {
        if (overLimit) {
          // Only blame the limit if that's really why — otherwise it's the
          // ordinary "someone else got there first".
          const order = await prisma.order.findUnique({ where: { id: orderId } });
          if (order && order.paymentMethod === "cash_on_delivery" && order.riderId === null && order.status === "READY_FOR_PICKUP") {
            throw new CashFloatLimitError();
          }
        }
        throw new JobUnavailableError();
      }

      await writeTransition(prisma, orderId, "READY_FOR_PICKUP", "RIDER_ASSIGNED", userId);
      const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { vendor: true } });
      await notifyCustomer(order, "order_rider_assigned", { orderId });
      return redactForRider(order);
    },

    /**
     * US-R-04/05 — reconstructs the rider's current job on load (e.g.
     * after a refresh mid-delivery). Nothing else exposes "what am I
     * currently carrying" — `listOpenJobs` only ever returns *unclaimed*
     * jobs, so a rider's own active one never appears there once accepted.
     */
    async getActiveJob(userId: string) {
      const rider = await getOwnRider(userId);
      const order = await prisma.order.findFirst({
        where: { riderId: rider.id, status: { in: ["RIDER_ASSIGNED", "IN_TRANSIT"] } },
        include: { vendor: true },
      });
      return order ? redactForRider(order) : null;
    },

    /** No penalty (US-R-03) — see the class comment on listOpenJobs for why this doesn't persist anything. */
    async declineJob(userId: string, orderId: string) {
      await getOwnRider(userId);
      const order = await prisma.order.findUnique({ where: { id: orderId } });
      if (!order) throw new OrderNotFoundError();
    },

    /** US-R-04 — the first of two handoff checks: the vendor's own dashboard shows collectionCode and reads it to the rider in person (see the schema comment on Order.collectionCode for why the rider's own app never does). */
    async confirmCollection(userId: string, orderId: string, input: ConfirmCollectionInput) {
      const order = await getOwnedRiderOrder(userId, orderId);
      if (order.status !== "RIDER_ASSIGNED") throw new JobUnavailableError(`Cannot confirm collection for an order in status ${order.status}.`);
      if (order.collectionCode !== input.code) throw new InvalidCollectionCodeError();

      await prisma.order.update({ where: { id: orderId }, data: { status: "IN_TRANSIT" } });
      await writeTransition(prisma, orderId, "RIDER_ASSIGNED", "IN_TRANSIT", userId);
      const updated = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      await notifyCustomer(updated, "order_in_transit", { orderId });
      return redactForRider(updated);
    },

    /**
     * US-R-05 — the moment cash-on-delivery money actually enters the
     * books (order/ledger.ts's codCollectionEntries), since nothing moved
     * at checkout for COD. Also the second handoff check: when the order
     * has a deliveryCode (every delivery order, since markReady), the
     * customer reads it to the rider and it must match exactly — the same
     * shape of check confirmCollection already does against the vendor's
     * code. A mismatch rejects outright rather than falling back to
     * recipientName/photo as an alternative; "I couldn't get the code"
     * is what reportDeliveryFailed is for, not a quieter way past this.
     */
    async confirmDelivery(userId: string, orderId: string, input: ConfirmDeliveryInput) {
      const rider = await getOwnRider(userId);
      const order = await getOwnedRiderOrder(userId, orderId);
      if (order.status !== "IN_TRANSIT") throw new JobUnavailableError(`Cannot confirm delivery for an order in status ${order.status}.`);
      if (order.deliveryCode && input.code !== order.deliveryCode) throw new InvalidDeliveryCodeError();

      if (order.paymentMethod === "cash_on_delivery") {
        if (input.cashCollectedMinor !== order.totalMinor) {
          throw new CashAmountMismatchError(order.totalMinor);
        }
        await postLedgerEntries(prisma, codCollectionEntries(orderId, order.totalMinor));
        await prisma.riderProfile.update({
          where: { id: rider.id },
          data: { cashBalanceMinor: { increment: order.totalMinor } }, // owed back to the platform — US-R-08
        });
      }

      await prisma.order.update({ where: { id: orderId }, data: { status: "DELIVERED" } });
      await writeTransition(prisma, orderId, "IN_TRANSIT", "DELIVERED", userId);

      const escrowReleaseWindowHours = await ConfigKeys.escrowReleaseWindowHours(prisma);
      await scheduleTimer("escrow-release", orderId, () => queue.scheduleEscrowRelease(orderId, escrowReleaseWindowHours));

      const updated = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      await notifyCustomer(updated, "order_delivered", { orderId });
      return redactForRider(updated);
    },

    /** US-R-06 — admin follow-up (whether to return goods, refund) isn't built yet; this just records the failure honestly rather than pretending to resolve it. */
    async reportDeliveryFailed(userId: string, orderId: string, input: DeliveryFailedInput) {
      const order = await getOwnedRiderOrder(userId, orderId);
      if (order.status !== "IN_TRANSIT") throw new JobUnavailableError(`Cannot report failure for an order in status ${order.status}.`);

      await prisma.order.update({ where: { id: orderId }, data: { status: "DELIVERY_FAILED" } });
      await writeTransition(prisma, orderId, "IN_TRANSIT", "DELIVERY_FAILED", userId, `${input.reason}${input.notes ? `: ${input.notes}` : ""}`);
      const updated = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      await notifyCustomer(updated, "order_delivery_failed", { orderId, reason: input.reason });
      return redactForRider(updated);
    },

    /** US-R-07 */
    async getEarnings(userId: string) {
      const rider = await getOwnRider(userId);
      const orders = await prisma.order.findMany({ where: { riderId: rider.id }, orderBy: { updatedAt: "desc" } });

      const cleared = orders.filter((o) => o.status === "COMPLETED");
      const pending = orders.filter((o) => ["RIDER_ASSIGNED", "IN_TRANSIT", "DELIVERED"].includes(o.status));

      return {
        clearedMinor: cleared.reduce((s, o) => s + o.deliveryFeeMinor, 0),
        pendingMinor: pending.reduce((s, o) => s + o.deliveryFeeMinor, 0),
        cashBalanceMinor: rider.cashBalanceMinor, // owed back to the platform (US-R-08) — reduced when an admin records a remittance
        cashFloatLimitMinor: await ConfigKeys.riderCashFloatLimitMinor(prisma),
        deliveries: cleared.map((o) => ({ orderId: o.id, amountMinor: o.deliveryFeeMinor, completedAt: o.updatedAt })),
      };
    },

    /** US-R-08 — "the rider can see a history of remittances." Newest first; `recordedBy` (an admin's user id) is deliberately not selected. */
    async listRemittances(userId: string) {
      const rider = await getOwnRider(userId);
      return prisma.riderCashRemittance.findMany({
        where: { riderId: rider.id },
        select: { id: true, amountMinor: true, note: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
    },
  };

  async function getOwnedRiderOrder(userId: string, orderId: string) {
    const rider = await prisma.riderProfile.findUnique({ where: { userId } });
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!rider || !order || order.riderId !== rider.id) throw new OrderNotFoundError();
    return order;
  }
}

export type DispatchService = ReturnType<typeof createDispatchService>;
