import Fastify from "fastify";
import sensible from "@fastify/sensible";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { envPlugin } from "./plugins/env.js";
import { prismaPlugin } from "./plugins/prisma.js";
import { redisPlugin } from "./plugins/redis.js";
import { notificationsPlugin } from "./plugins/notifications.js";
import { staffAuthRoutes } from "./modules/auth/routes.js";
import { customerAuthRoutes } from "./modules/auth/customer/routes.js";
import { catalogRoutes } from "./modules/catalog/routes.js";
import { orderRoutes } from "./modules/order/routes.js";
import { dispatchRoutes } from "./modules/dispatch/routes.js";
import { adminRoutes } from "./modules/admin/routes.js";
import { payoutRoutes } from "./modules/payouts/routes.js";
import { notificationRoutes } from "./modules/notifications/routes.js";
import { requireAuth } from "./lib/auth-guard.js";
import { serializeUser } from "./lib/serialize-user.js";

/**
 * Module registration order matters: env must load before anything that
 * reads app.env (prisma/redis connection strings, Termii keys), and
 * prisma/redis must be ready before any route that touches them.
 *
 * Auth is two separate route sets, by role (brief §3.1b) — staff (phone/
 * OTP) and customer (email/password/OAuth). Catalog, Order/Checkout and
 * Dispatch are real, M1 (roadmap.md). Admin is real for application
 * vetting (US-A-01) and payouts — the rest of api-contracts.md's Admin
 * section (order oversight, disputes, config writes, metrics, audit-log
 * search) is a real module boundary already but its routes aren't built
 * yet.
 *
 * notificationsPlugin registers before order/dispatch/admin routes
 * specifically so their service factories can take `app.notifications` as
 * a dependency (architecture.md: "push notification fires from the module
 * that made the transition, same request").
 */
export async function buildApp() {
  const app = Fastify({
    logger: {
      transport: process.env.NODE_ENV !== "production" ? { target: "pino-pretty" } : undefined,
    },
  });

  await app.register(envPlugin);
  await app.register(sensible);
  // Every browser-facing app (customer/vendor/rider/admin, local dev and
  // Netlify) calls this API cross-origin — no shared parent domain, so
  // without this the browser silently discards every response regardless
  // of it succeeding server-side. app.env.CORS_ORIGINS (env.ts) is the
  // allowlist; credentials stay false since auth is a bearer JWT in an
  // Authorization header, not a cookie (nothing to send credentialed).
  await app.register(cors, {
    origin: app.env.CORS_ORIGINS.split(",").map((o) => o.trim()),
    credentials: false,
  });
  await app.register(rateLimit, { max: 100, timeWindow: "1 minute", global: true });
  await app.register(prismaPlugin);
  await app.register(redisPlugin);
  await app.register(notificationsPlugin);

  app.get("/health", async () => ({ status: "ok" }));

  // Shared by every role — mainly for the OAuth redirect landing page,
  // which only gets tokens on the callback URL, not the full user object.
  app.get("/auth/me", { preHandler: requireAuth() }, async (req, reply) => {
    const user = await app.prisma.user.findUniqueOrThrow({ where: { id: req.authUser!.sub } });
    return reply.send({ user: serializeUser(user) });
  });

  await app.register(staffAuthRoutes);
  await app.register(customerAuthRoutes);
  await app.register(catalogRoutes);
  await app.register(orderRoutes);
  await app.register(dispatchRoutes);
  await app.register(adminRoutes);
  await app.register(payoutRoutes);
  await app.register(notificationRoutes);

  return app;
}
