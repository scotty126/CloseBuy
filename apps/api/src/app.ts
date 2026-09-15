import Fastify from "fastify";
import sensible from "@fastify/sensible";
import rateLimit from "@fastify/rate-limit";
import { envPlugin } from "./plugins/env.js";
import { prismaPlugin } from "./plugins/prisma.js";
import { redisPlugin } from "./plugins/redis.js";
import { authRoutes } from "./modules/auth/routes.js";
import { catalogRoutes } from "./modules/catalog/routes.js";

/**
 * Module registration order matters: env must load before anything that
 * reads app.env (prisma/redis connection strings, Termii keys), and
 * prisma/redis must be ready before any route that touches them.
 *
 * Only Auth and a smoke-test Catalog read are wired up — M0 scope
 * (roadmap.md). Cart, Order, Payments, Dispatch, Notifications and Admin
 * are real module boundaries in architecture.md §2 and in the Prisma
 * schema already, but their routes are M1+ and deliberately not built yet.
 */
export async function buildApp() {
  const app = Fastify({
    logger: {
      transport: process.env.NODE_ENV !== "production" ? { target: "pino-pretty" } : undefined,
    },
  });

  await app.register(envPlugin);
  await app.register(sensible);
  await app.register(rateLimit, { max: 100, timeWindow: "1 minute", global: true });
  await app.register(prismaPlugin);
  await app.register(redisPlugin);

  app.get("/health", async () => ({ status: "ok" }));

  await app.register(authRoutes);
  await app.register(catalogRoutes);

  return app;
}
