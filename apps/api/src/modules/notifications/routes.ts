import type { FastifyInstance } from "fastify";
import { pushSubscribeSchema, pushUnsubscribeSchema } from "@closebuy/types";
import { requireAuth } from "../../lib/auth-guard.js";
import { NotificationNotFoundError } from "./service.js";

/**
 * Notifications — any authenticated user (api-contracts.md), not
 * role-restricted the way Catalog/Order/Dispatch/Admin are. The service
 * itself lives on `app.notifications` (plugins/notifications.ts), created
 * once and shared with Order/Dispatch/Admin's own service factories —
 * not constructed here, unlike every other module's routes.ts, since
 * those modules need the same instance to fire into.
 */
export async function notificationRoutes(app: FastifyInstance) {
  app.post("/notifications/subscribe", { preHandler: requireAuth() }, async (req, reply) => {
    const body = pushSubscribeSchema.parse(req.body);
    await app.notifications.subscribe(req.authUser!.sub, body);
    return reply.code(204).send();
  });

  // The VAPID *public* key is public by design (the browser needs it to
  // subscribe) — served from the API rather than baked into each frontend
  // at build time, so turning push on is just setting an env var here.
  // `null` means push isn't configured, and the apps hide the toggle.
  app.get("/notifications/vapid-key", async (_req, reply) => {
    return reply.send({ publicKey: app.env.VAPID_PRIVATE_KEY ? (app.env.VAPID_PUBLIC_KEY ?? null) : null });
  });

  app.post("/notifications/unsubscribe", { preHandler: requireAuth() }, async (req, reply) => {
    const { endpoint } = pushUnsubscribeSchema.parse(req.body);
    await app.notifications.unsubscribe(req.authUser!.sub, endpoint);
    return reply.code(204).send();
  });

  app.get("/notifications", { preHandler: requireAuth() }, async (req, reply) => {
    return reply.send({ notifications: await app.notifications.list(req.authUser!.sub) });
  });

  app.post("/notifications/:id/read", { preHandler: requireAuth() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      await app.notifications.markRead(req.authUser!.sub, id);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof NotificationNotFoundError) {
        return reply.code(404).send({ error: { code: "NOTIFICATION_NOT_FOUND", message: err.message } });
      }
      throw err;
    }
  });
}
