import { Redis } from "ioredis";
import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";

declare module "fastify" {
  interface FastifyInstance {
    redis: Redis;
  }
}

export const redisPlugin = fp(async (app: FastifyInstance) => {
  const redis = new Redis(app.env.REDIS_URL, { maxRetriesPerRequest: 3 });

  app.decorate("redis", redis);
  app.addHook("onClose", async (instance) => {
    instance.redis.disconnect();
  });
});
