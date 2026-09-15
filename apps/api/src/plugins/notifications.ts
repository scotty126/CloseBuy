import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { createPushClient } from "../modules/notifications/push.js";
import { createNotificationService, type NotificationService } from "../modules/notifications/service.js";

declare module "fastify" {
  interface FastifyInstance {
    notifications: NotificationService;
  }
}

/**
 * One shared instance, decorated onto the Fastify instance like
 * prisma/redis rather than constructed per-module — Order/Dispatch/
 * Admin's own service factories take it as a plain dependency
 * (OrderServiceDeps.notifications etc.) so app.ts only ever wires one
 * copy together, not four. Registered after prismaPlugin (needs
 * app.prisma) and envPlugin (needs the VAPID_* keys).
 */
export const notificationsPlugin = fp(async (app: FastifyInstance) => {
  const push = createPushClient(app.env.VAPID_PUBLIC_KEY, app.env.VAPID_PRIVATE_KEY, app.env.VAPID_SUBJECT);
  app.decorate("notifications", createNotificationService({ prisma: app.prisma, push }));
});
