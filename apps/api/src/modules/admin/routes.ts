import type { FastifyInstance } from "fastify";
import { applicationTypeSchema, applicationRejectSchema } from "@closebuy/types";
import { requireAuth } from "../../lib/auth-guard.js";
import {
  createAdminService,
  ApplicationNotFoundError,
  InvalidApplicationStateError,
} from "./service.js";

/**
 * Admin — vendor/rider application vetting (US-A-01). See service.ts for
 * why this is the only slice of api-contracts.md's Admin section built so
 * far: it's the one that unblocks the whole pipeline, everything else
 * there is real future scope, not forgotten.
 */
export async function adminRoutes(app: FastifyInstance) {
  const admin = createAdminService({ prisma: app.prisma, notifications: app.notifications });

  app.get("/admin/applications", { preHandler: requireAuth(["admin"]) }, async (_req, reply) => {
    return reply.send({ applications: await admin.listPendingApplications() });
  });

  app.post("/admin/applications/:type/:id/approve", { preHandler: requireAuth(["admin"]) }, async (req, reply) => {
    const { type, id } = req.params as { type: string; id: string };
    const parsedType = applicationTypeSchema.parse(type);
    try {
      const application = await admin.approveApplication(req.authUser!.sub, parsedType, id);
      return reply.send({ application });
    } catch (err) {
      if (err instanceof ApplicationNotFoundError) {
        return reply.code(404).send({ error: { code: "APPLICATION_NOT_FOUND", message: err.message } });
      }
      if (err instanceof InvalidApplicationStateError) {
        return reply.code(409).send({ error: { code: "ALREADY_DECIDED", message: err.message } });
      }
      throw err;
    }
  });

  app.post("/admin/applications/:type/:id/reject", { preHandler: requireAuth(["admin"]) }, async (req, reply) => {
    const { type, id } = req.params as { type: string; id: string };
    const parsedType = applicationTypeSchema.parse(type);
    const body = applicationRejectSchema.parse(req.body);
    try {
      const application = await admin.rejectApplication(req.authUser!.sub, parsedType, id, body.reason);
      return reply.send({ application });
    } catch (err) {
      if (err instanceof ApplicationNotFoundError) {
        return reply.code(404).send({ error: { code: "APPLICATION_NOT_FOUND", message: err.message } });
      }
      if (err instanceof InvalidApplicationStateError) {
        return reply.code(409).send({ error: { code: "ALREADY_DECIDED", message: err.message } });
      }
      throw err;
    }
  });
}
