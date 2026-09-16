import type { PrismaClient, Order } from "@prisma/client";
import type { OrderQueue } from "../order/jobs.js";
import type { NotificationService } from "../notifications/service.js";
import { ConfigKeys } from "../../lib/config.js";
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
export class CashAmountMismatchError extends Error {
  constructor(expectedMinor: number) {
    super(`Cash collected must match the order total exactly (₦${(expectedMinor / 100).toFixed(2)}).`);
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

      return prisma.order.findMany({
        where: { status: "READY_FOR_PICKUP", fulfilmentType: "delivery", riderId: null },
        include: { vendor: true },
        orderBy: { updatedAt: "asc" },
      });
    },

    /** US-R-03 — atomic claim; two riders racing for the same job can never both win (the `updateMany` count is the guard, same pattern as US-V-04's stock decrement). */
    async claimJob(userId: string, orderId: string) {
      const rider = await getOwnRider(userId);
      if (rider.status !== "approved" || !rider.onDuty) throw new JobUnavailableError("You need to be on duty to accept jobs.");

      const { count } = await prisma.order.updateMany({
        where: { id: orderId, riderId: null, status: "READY_FOR_PICKUP", fulfilmentType: "delivery" },
        data: { riderId: rider.id, status: "RIDER_ASSIGNED" },
      });
      if (count === 0) throw new JobUnavailableError();

      await writeTransition(prisma, orderId, "READY_FOR_PICKUP", "RIDER_ASSIGNED", userId);
      const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { vendor: true } });
      await notifyCustomer(order, "order_rider_assigned", { orderId });
      return order;
    },

    /**
     * US-R-04/05 — reconstructs the rider's current job on load (e.g.
     * after a refresh mid-delivery). Nothing else exposes "what am I
     * currently carrying" — `listOpenJobs` only ever returns *unclaimed*
     * jobs, so a rider's own active one never appears there once accepted.
     */
    async getActiveJob(userId: string) {
      const rider = await getOwnRider(userId);
      return prisma.order.findFirst({
        where: { riderId: rider.id, status: { in: ["RIDER_ASSIGNED", "IN_TRANSIT"] } },
        include: { vendor: true },
      });
    },

    /** No penalty (US-R-03) — see the class comment on listOpenJobs for why this doesn't persist anything. */
    async declineJob(userId: string, orderId: string) {
      await getOwnRider(userId);
      const order = await prisma.order.findUnique({ where: { id: orderId } });
      if (!order) throw new OrderNotFoundError();
    },

    /** US-R-04 — checked against the same collection_code the vendor's dashboard shows (one field, two directions — see the schema comment on Order.collectionCode). */
    async confirmCollection(userId: string, orderId: string, input: ConfirmCollectionInput) {
      const order = await getOwnedRiderOrder(userId, orderId);
      if (order.status !== "RIDER_ASSIGNED") throw new JobUnavailableError(`Cannot confirm collection for an order in status ${order.status}.`);
      if (order.collectionCode !== input.code) throw new InvalidCollectionCodeError();

      await prisma.order.update({ where: { id: orderId }, data: { status: "IN_TRANSIT" } });
      await writeTransition(prisma, orderId, "RIDER_ASSIGNED", "IN_TRANSIT", userId);
      const updated = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      await notifyCustomer(updated, "order_in_transit", { orderId });
      return updated;
    },

    /** US-R-05 — the moment cash-on-delivery money actually enters the books (order/ledger.ts's codCollectionEntries), since nothing moved at checkout for COD. */
    async confirmDelivery(userId: string, orderId: string, input: ConfirmDeliveryInput) {
      const rider = await getOwnRider(userId);
      const order = await getOwnedRiderOrder(userId, orderId);
      if (order.status !== "IN_TRANSIT") throw new JobUnavailableError(`Cannot confirm delivery for an order in status ${order.status}.`);

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
      await queue.scheduleEscrowRelease(orderId, escrowReleaseWindowHours);

      const updated = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      await notifyCustomer(updated, "order_delivered", { orderId });
      return updated;
    },

    /** US-R-06 — admin follow-up (whether to return goods, refund) isn't built yet; this just records the failure honestly rather than pretending to resolve it. */
    async reportDeliveryFailed(userId: string, orderId: string, input: DeliveryFailedInput) {
      const order = await getOwnedRiderOrder(userId, orderId);
      if (order.status !== "IN_TRANSIT") throw new JobUnavailableError(`Cannot report failure for an order in status ${order.status}.`);

      await prisma.order.update({ where: { id: orderId }, data: { status: "DELIVERY_FAILED" } });
      await writeTransition(prisma, orderId, "IN_TRANSIT", "DELIVERY_FAILED", userId, `${input.reason}${input.notes ? `: ${input.notes}` : ""}`);
      const updated = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      await notifyCustomer(updated, "order_delivery_failed", { orderId, reason: input.reason });
      return updated;
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
        cashBalanceMinor: rider.cashBalanceMinor, // owed back to the platform (US-R-08) — remittance flow itself isn't built yet
        deliveries: cleared.map((o) => ({ orderId: o.id, amountMinor: o.deliveryFeeMinor, completedAt: o.updatedAt })),
      };
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
