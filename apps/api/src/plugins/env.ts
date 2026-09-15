import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { loadEnv, type Env } from "../env.js";

declare module "fastify" {
  interface FastifyInstance {
    env: Env;
  }
}

// Registered first, before every other plugin — nothing else should read
// process.env directly once this exists.
export const envPlugin = fp(async (app: FastifyInstance) => {
  app.decorate("env", loadEnv());
});
