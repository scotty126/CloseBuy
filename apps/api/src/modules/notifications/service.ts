import type { PrismaClient, Prisma } from "@prisma/client";
import type { NotificationType, PushSubscribeInput } from "@closebuy/types";
import type { PushClient } from "./push.js";

export class NotificationNotFoundError extends Error {
  constructor() {
    super("Notification not found.");
  }
}

export interface NotificationServiceDeps {
  prisma: PrismaClient;
  push: PushClient;
}

/**
 * Notifications — the informational layer (architecture.md §2): Order,
 * Dispatch and Admin each fire into `notify()` at the point of a state
 * change, same request, never the other way around ("Catalog and Ledger
 * never depend on Notifications or Admin" — architecture.md). `notify`
 * therefore must never throw: a push failure, or even a DB hiccup writing
 * the notification row, should degrade the informational layer, not fail
 * the checkout/accept/dispatch action that triggered it.
 */
export function createNotificationService({ prisma, push }: NotificationServiceDeps) {
  return {
    /** US-notifications/subscribe — upserted on `endpoint` so re-subscribing the same device/browser updates keys instead of duplicating. */
    async subscribe(userId: string, input: PushSubscribeInput) {
      await prisma.pushSubscription.upsert({
        where: { endpoint: input.endpoint },
        update: { userId, p256dh: input.keys.p256dh, auth: input.keys.auth },
        create: { userId, endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth },
      });
    },

    /** In-app feed — real and complete regardless of whether push/VAPID is configured at all. */
    async list(userId: string) {
      return prisma.notification.findMany({ where: { userId }, orderBy: { sentAt: "desc" }, take: 50 });
    },

    async markRead(userId: string, id: string) {
      const { count } = await prisma.notification.updateMany({
        where: { id, userId },
        data: { readAt: new Date() },
      });
      if (count === 0) throw new NotificationNotFoundError();
    },

    /**
     * The one function every other module calls. Always writes the in-app
     * row first — that's the durable record or US-A-01/R-07's acceptance
     * criteria mean nothing if it silently fails. Push is then attempted
     * per subscribed device, best-effort; an expired subscription is
     * pruned right here rather than left to accumulate.
     */
    async notify(userId: string, type: NotificationType, payload: Record<string, unknown>) {
      try {
        await prisma.notification.create({ data: { userId, type, payload: payload as Prisma.InputJsonValue } });
      } catch (err) {
        console.error(`notify: failed to write notification (${type}) for user ${userId}`, err);
        return;
      }

      if (!push.isConfigured) return;

      const subscriptions = await prisma.pushSubscription.findMany({ where: { userId } });
      if (subscriptions.length === 0) return;

      const results = await Promise.all(
        subscriptions.map(async (sub) => ({
          id: sub.id,
          result: await push.send({ endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth }, { type, payload }),
        })),
      );

      const expiredIds = results.filter((r) => r.result.expired).map((r) => r.id);
      if (expiredIds.length > 0) {
        await prisma.pushSubscription.deleteMany({ where: { id: { in: expiredIds } } });
      }
    },
  };
}

export type NotificationService = ReturnType<typeof createNotificationService>;
