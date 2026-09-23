import type { FastifyInstance } from "fastify";
import {
  applicationTypeSchema,
  applicationRejectSchema,
  adminOrderFilterSchema,
  adminOrderActionSchema,
  auditLogFilterSchema,
} from "@closebuy/types";
import { requireAuth } from "../../lib/auth-guard.js";
import { createMonnifyClient } from "../payments/monnify.js";
import {
  createAdminService,
  ApplicationNotFoundError,
  InvalidApplicationStateError,
} from "./service.js";
import {
  createAdminOrderService,
  OrderNotFoundError,
  InvalidOrderStateError,
  NoRiderAssignedError,
  NothingToRefundError,
} from "./orders.js";

/**
 * Admin — vendor/rider application vetting (US-A-01, service.ts), order
 * oversight (US-A-03, orders.ts) and audit-log search (US-A-08,
 * service.ts). Payouts live in ../payouts/routes.js instead (their own
 * vendor-request/admin-approve flow). Still real, still not built:
 * disputes, config writes, reconciliation, metrics, suspension —
 * S-priority (M3), not forgotten.
 */
export async function adminRoutes(app: FastifyInstance) {
  const admin = createAdminService({ prisma: app.prisma, notifications: app.notifications });
  const monnify = createMonnifyClient(
    app.env.MONNIFY_API_KEY,
    app.env.MONNIFY_SECRET_KEY,
    app.env.MONNIFY_CONTRACT_CODE,
    app.env.NODE_ENV,
    app.env.MONNIFY_DISBURSEMENT_SOURCE_ACCOUNT_NUMBER,
  );
  const adminOrders = createAdminOrderService({ prisma: app.prisma, monnify, notifications: app.notifications });

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

  // ── Order oversight (US-A-03) ───────────────────────────────────────

  app.get("/admin/orders", { preHandler: requireAuth(["admin"]) }, async (req, reply) => {
    const filter = adminOrderFilterSchema.parse(req.query);
    const { orders, nextCursor } = await adminOrders.listOrders(filter);
    return reply.send({ orders, nextCursor });
  });

  app.get("/admin/orders/:id", { preHandler: requireAuth(["admin"]) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const order = await adminOrders.getOrder(id);
      return reply.send({ order });
    } catch (err) {
      if (err instanceof OrderNotFoundError) {
        return reply.code(404).send({ error: { code: "ORDER_NOT_FOUND", message: err.message } });
      }
      throw err;
    }
  });

  app.post("/admin/orders/:id/reassign-rider", { preHandler: requireAuth(["admin"]) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = adminOrderActionSchema.parse(req.body);
    try {
      const order = await adminOrders.reassignRider(req.authUser!.sub, id, body.reason);
      return reply.send({ order });
    } catch (err) {
      if (err instanceof OrderNotFoundError) {
        return reply.code(404).send({ error: { code: "ORDER_NOT_FOUND", message: err.message } });
      }
      if (err instanceof NoRiderAssignedError) {
        return reply.code(409).send({ error: { code: "NO_RIDER_ASSIGNED", message: err.message } });
      }
      if (err instanceof InvalidOrderStateError) {
        return reply.code(409).send({ error: { code: "INVALID_ORDER_STATE", message: err.message } });
      }
      throw err;
    }
  });

  app.post("/admin/orders/:id/force-cancel", { preHandler: requireAuth(["admin"]) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = adminOrderActionSchema.parse(req.body);
    try {
      const order = await adminOrders.forceCancelOrder(req.authUser!.sub, id, body.reason);
      return reply.send({ order });
    } catch (err) {
      if (err instanceof OrderNotFoundError) {
        return reply.code(404).send({ error: { code: "ORDER_NOT_FOUND", message: err.message } });
      }
      if (err instanceof InvalidOrderStateError) {
        return reply.code(409).send({ error: { code: "INVALID_ORDER_STATE", message: err.message } });
      }
      throw err;
    }
  });

  app.post("/admin/orders/:id/force-refund", { preHandler: requireAuth(["admin"]) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = adminOrderActionSchema.parse(req.body);
    try {
      const order = await adminOrders.forceRefundOrder(req.authUser!.sub, id, body.reason);
      return reply.send({ order });
    } catch (err) {
      if (err instanceof OrderNotFoundError) {
        return reply.code(404).send({ error: { code: "ORDER_NOT_FOUND", message: err.message } });
      }
      if (err instanceof NothingToRefundError) {
        return reply.code(409).send({ error: { code: "NOTHING_TO_REFUND", message: err.message } });
      }
      throw err;
    }
  });

  // ── Audit log (US-A-08) ─────────────────────────────────────────────

  app.get("/admin/audit-log", { preHandler: requireAuth(["admin"]) }, async (req, reply) => {
    const filter = auditLogFilterSchema.parse(req.query);
    const { entries, nextCursor } = await admin.searchAuditLog(filter);
    return reply.send({ entries, nextCursor });
  });
}
