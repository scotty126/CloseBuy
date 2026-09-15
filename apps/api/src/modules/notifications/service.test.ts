import { describe, it, expect, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createNotificationService, NotificationNotFoundError } from "./service.js";
import type { PushClient, PushSendResult } from "./push.js";

function createFakePrisma() {
  const notifications = new Map<string, any>();
  const subscriptions = new Map<string, any>();
  let nextId = 1;
  const id = () => `id_${nextId++}`;

  const db = {
    notification: {
      create: async ({ data }: any) => {
        const n = { id: id(), sentAt: new Date(), readAt: null, ...data };
        notifications.set(n.id, n);
        return n;
      },
      findMany: async ({ where }: any) =>
        [...notifications.values()]
          .filter((n) => n.userId === where.userId)
          .sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime()),
      updateMany: async ({ where, data }: any) => {
        const match = [...notifications.values()].find((n) => n.id === where.id && n.userId === where.userId);
        if (!match) return { count: 0 };
        notifications.set(match.id, { ...match, ...data });
        return { count: 1 };
      },
    },
    pushSubscription: {
      upsert: async ({ where, update, create }: any) => {
        const existing = subscriptions.get(where.endpoint);
        const sub = existing ? { ...existing, ...update } : { id: id(), endpoint: where.endpoint, ...create };
        subscriptions.set(sub.endpoint, sub);
        return sub;
      },
      findMany: async ({ where }: any) => [...subscriptions.values()].filter((s) => s.userId === where.userId),
      deleteMany: async ({ where }: any) => {
        let count = 0;
        for (const s of [...subscriptions.values()]) {
          if (where.id.in.includes(s.id)) {
            subscriptions.delete(s.endpoint);
            count++;
          }
        }
        return { count };
      },
    },
    __state: { notifications, subscriptions },
  };

  return db as unknown as PrismaClient & { __state: typeof db.__state };
}

function createFakePush(sendImpl?: (subscription: any, payload: unknown) => Promise<PushSendResult>): PushClient {
  return {
    isConfigured: true,
    send: vi.fn(sendImpl ?? (async () => ({ delivered: true, expired: false }))),
  };
}

const USER_ID = "user_1";

describe("notification service", () => {
  let prisma: ReturnType<typeof createFakePrisma>;

  beforeEach(() => {
    prisma = createFakePrisma();
  });

  it("notify always writes the in-app row, even with no push configured (the durable record, US-A-01/R-07)", async () => {
    const push: PushClient = { isConfigured: false, send: vi.fn() };
    const service = createNotificationService({ prisma, push });

    await service.notify(USER_ID, "order_accepted", { orderId: "order_1" });

    expect(push.send).not.toHaveBeenCalled();
    const feed = await service.list(USER_ID);
    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({ type: "order_accepted", payload: { orderId: "order_1" } });
  });

  it("a notify failure (bad DB write) never throws — the caller's checkout/accept/dispatch action must not fail because of it", async () => {
    const failingPrisma = {
      ...prisma,
      notification: { ...prisma.notification, create: vi.fn().mockRejectedValue(new Error("db down")) },
    } as unknown as PrismaClient;
    const push = createFakePush();
    const service = createNotificationService({ prisma: failingPrisma, push });

    await expect(service.notify(USER_ID, "order_accepted", {})).resolves.toBeUndefined();
  });

  it("subscribe upserts by endpoint — re-subscribing the same device updates keys instead of duplicating", async () => {
    const push = createFakePush();
    const service = createNotificationService({ prisma, push });

    await service.subscribe(USER_ID, { endpoint: "https://push.example/abc", keys: { p256dh: "key1", auth: "auth1" } });
    await service.subscribe(USER_ID, { endpoint: "https://push.example/abc", keys: { p256dh: "key2", auth: "auth1" } });

    expect(prisma.__state.subscriptions.size).toBe(1);
    expect(prisma.__state.subscriptions.get("https://push.example/abc").p256dh).toBe("key2");
  });

  it("notify sends push to every subscribed device once push is configured", async () => {
    const push = createFakePush();
    const service = createNotificationService({ prisma, push });
    await service.subscribe(USER_ID, { endpoint: "https://push.example/a", keys: { p256dh: "k", auth: "a" } });
    await service.subscribe(USER_ID, { endpoint: "https://push.example/b", keys: { p256dh: "k", auth: "a" } });

    await service.notify(USER_ID, "order_delivered", { orderId: "order_1" });

    expect(push.send).toHaveBeenCalledTimes(2);
  });

  it("prunes a subscription the push service reports as expired (404/410), rather than retrying it forever", async () => {
    const push = createFakePush(async (subscription) =>
      subscription.endpoint === "https://push.example/dead"
        ? { delivered: false, expired: true }
        : { delivered: true, expired: false },
    );
    const service = createNotificationService({ prisma, push });
    await service.subscribe(USER_ID, { endpoint: "https://push.example/dead", keys: { p256dh: "k", auth: "a" } });
    await service.subscribe(USER_ID, { endpoint: "https://push.example/alive", keys: { p256dh: "k", auth: "a" } });

    await service.notify(USER_ID, "order_delivered", { orderId: "order_1" });

    expect(prisma.__state.subscriptions.has("https://push.example/dead")).toBe(false);
    expect(prisma.__state.subscriptions.has("https://push.example/alive")).toBe(true);
  });

  it("markRead only marks a notification belonging to that user, and throws otherwise", async () => {
    const push = createFakePush();
    const service = createNotificationService({ prisma, push });
    await service.notify(USER_ID, "order_delivered", {});
    const [notification] = await service.list(USER_ID);

    await expect(service.markRead("someone_else", notification!.id)).rejects.toThrow(NotificationNotFoundError);

    await service.markRead(USER_ID, notification!.id);
    const [updated] = await service.list(USER_ID);
    expect(updated!.readAt).not.toBeNull();
  });
});
