import type { FastifyInstance } from "fastify";
import {
  applicationTypeSchema,
  applicationRejectSchema,
  adminOrderFilterSchema,
  adminOrderActionSchema,
  adminDisputeFilterSchema,
  disputeResolveSchema,
  adminActorActionSchema,
  recordRemittanceSchema,
  configUpdateSchema,
  categoryCreateSchema,
  categoryUpdateSchema,
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
import {
  createAdminDisputeService,
  DisputeNotFoundError,
  DisputeAlreadyResolvedError,
  InvalidResolutionError,
  NothingToRefundError as DisputeNothingToRefundError,
} from "./disputes.js";
import {
  createAdminActorService,
  ActorNotFoundError,
  InvalidActorStateError,
} from "./actors.js";
import { createAdminConfigService, CategoryNotFoundError } from "./config.js";
import {
  createAdminRemittanceService,
  RiderNotFoundError as RemittanceRiderNotFoundError,
  RemittanceExceedsBalanceError,
} from "./remittances.js";

/**
 * Admin — vendor/rider application vetting (US-A-01, service.ts), order
 * oversight (US-A-03, orders.ts), dispute resolution (US-A-04,
 * disputes.ts), config writes (US-A-02, config.ts), actor suspension
 * (US-A-06, actors.ts), rider cash remittance (US-R-08, remittances.ts) and audit-log search (US-A-08, service.ts). Payouts
 * live in ../payouts/routes.js instead (their own vendor-request/
 * admin-approve flow). Still real, still not built: reconciliation,
 * metrics — M-priority (M3), not forgotten.
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
  const adminDisputes = createAdminDisputeService({ prisma: app.prisma, monnify, notifications: app.notifications });
  const adminActors = createAdminActorService({ prisma: app.prisma, notifications: app.notifications });
  const adminConfig = createAdminConfigService({ prisma: app.prisma });
  const adminRemittances = createAdminRemittanceService({ prisma: app.prisma, notifications: app.notifications });

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

  // ── Disputes (US-A-04) ───────────────────────────────────────────────

  app.get("/admin/disputes", { preHandler: requireAuth(["admin"]) }, async (req, reply) => {
    const filter = adminDisputeFilterSchema.parse(req.query);
    const { disputes, nextCursor } = await adminDisputes.listDisputes(filter);
    return reply.send({ disputes, nextCursor });
  });

  app.get("/admin/disputes/:id", { preHandler: requireAuth(["admin"]) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const dispute = await adminDisputes.getDispute(id);
      return reply.send({ dispute });
    } catch (err) {
      if (err instanceof DisputeNotFoundError) {
        return reply.code(404).send({ error: { code: "DISPUTE_NOT_FOUND", message: err.message } });
      }
      throw err;
    }
  });

  app.post("/admin/disputes/:id/resolve", { preHandler: requireAuth(["admin"]) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = disputeResolveSchema.parse(req.body);
    try {
      const dispute = await adminDisputes.resolveDispute(req.authUser!.sub, id, body);
      return reply.send({ dispute });
    } catch (err) {
      if (err instanceof DisputeNotFoundError) {
        return reply.code(404).send({ error: { code: "DISPUTE_NOT_FOUND", message: err.message } });
      }
      if (err instanceof DisputeAlreadyResolvedError) {
        return reply.code(409).send({ error: { code: "DISPUTE_ALREADY_RESOLVED", message: err.message } });
      }
      if (err instanceof InvalidResolutionError) {
        return reply.code(422).send({ error: { code: "INVALID_RESOLUTION", message: err.message } });
      }
      if (err instanceof DisputeNothingToRefundError) {
        return reply.code(409).send({ error: { code: "NOTHING_TO_REFUND", message: err.message } });
      }
      throw err;
    }
  });

  // ── Suspend an actor (US-A-06) ──────────────────────────────────────

  app.get("/admin/vendors", { preHandler: requireAuth(["admin"]) }, async (_req, reply) => {
    return reply.send({ vendors: await adminActors.listVendors() });
  });

  app.post("/admin/vendors/:id/suspend", { preHandler: requireAuth(["admin"]) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = adminActorActionSchema.parse(req.body);
    try {
      const result = await adminActors.suspendVendor(req.authUser!.sub, id, body.reason);
      return reply.send(result);
    } catch (err) {
      if (err instanceof ActorNotFoundError) {
        return reply.code(404).send({ error: { code: "VENDOR_NOT_FOUND", message: err.message } });
      }
      if (err instanceof InvalidActorStateError) {
        return reply.code(409).send({ error: { code: "INVALID_ACTOR_STATE", message: err.message } });
      }
      throw err;
    }
  });

  app.post("/admin/vendors/:id/unsuspend", { preHandler: requireAuth(["admin"]) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = adminActorActionSchema.parse(req.body);
    try {
      const vendor = await adminActors.unsuspendVendor(req.authUser!.sub, id, body.reason);
      return reply.send({ vendor });
    } catch (err) {
      if (err instanceof ActorNotFoundError) {
        return reply.code(404).send({ error: { code: "VENDOR_NOT_FOUND", message: err.message } });
      }
      if (err instanceof InvalidActorStateError) {
        return reply.code(409).send({ error: { code: "INVALID_ACTOR_STATE", message: err.message } });
      }
      throw err;
    }
  });

  app.get("/admin/riders", { preHandler: requireAuth(["admin"]) }, async (_req, reply) => {
    return reply.send({ riders: await adminActors.listRiders() });
  });

  app.post("/admin/riders/:id/suspend", { preHandler: requireAuth(["admin"]) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = adminActorActionSchema.parse(req.body);
    try {
      const result = await adminActors.suspendRider(req.authUser!.sub, id, body.reason);
      return reply.send(result);
    } catch (err) {
      if (err instanceof ActorNotFoundError) {
        return reply.code(404).send({ error: { code: "RIDER_NOT_FOUND", message: err.message } });
      }
      if (err instanceof InvalidActorStateError) {
        return reply.code(409).send({ error: { code: "INVALID_ACTOR_STATE", message: err.message } });
      }
      throw err;
    }
  });

  app.post("/admin/riders/:id/unsuspend", { preHandler: requireAuth(["admin"]) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = adminActorActionSchema.parse(req.body);
    try {
      const rider = await adminActors.unsuspendRider(req.authUser!.sub, id, body.reason);
      return reply.send({ rider });
    } catch (err) {
      if (err instanceof ActorNotFoundError) {
        return reply.code(404).send({ error: { code: "RIDER_NOT_FOUND", message: err.message } });
      }
      if (err instanceof InvalidActorStateError) {
        return reply.code(409).send({ error: { code: "INVALID_ACTOR_STATE", message: err.message } });
      }
      throw err;
    }
  });

  // ── Rider cash remittance (US-R-08) ─────────────────────────────────

  app.post("/admin/riders/:id/remittances", { preHandler: requireAuth(["admin"]) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = recordRemittanceSchema.parse(req.body);
    try {
      const result = await adminRemittances.recordRemittance(req.authUser!.sub, id, body);
      return reply.code(201).send(result);
    } catch (err) {
      if (err instanceof RemittanceRiderNotFoundError) {
        return reply.code(404).send({ error: { code: "RIDER_NOT_FOUND", message: err.message } });
      }
      if (err instanceof RemittanceExceedsBalanceError) {
        return reply.code(422).send({ error: { code: "REMITTANCE_EXCEEDS_BALANCE", message: err.message } });
      }
      throw err;
    }
  });

  app.get("/admin/riders/:id/remittances", { preHandler: requireAuth(["admin"]) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      return reply.send({ remittances: await adminRemittances.listRemittances(id) });
    } catch (err) {
      if (err instanceof RemittanceRiderNotFoundError) {
        return reply.code(404).send({ error: { code: "RIDER_NOT_FOUND", message: err.message } });
      }
      throw err;
    }
  });

  // ── Config writes (US-A-02) ─────────────────────────────────────────

  app.get("/admin/config", { preHandler: requireAuth(["admin"]) }, async (_req, reply) => {
    return reply.send(await adminConfig.getConfig());
  });

  app.patch("/admin/config", { preHandler: requireAuth(["admin"]) }, async (req, reply) => {
    const body = configUpdateSchema.parse(req.body);
    return reply.send(await adminConfig.updateConfig(req.authUser!.sub, body));
  });

  app.post("/admin/categories", { preHandler: requireAuth(["admin"]) }, async (req, reply) => {
    const body = categoryCreateSchema.parse(req.body);
    const category = await adminConfig.createCategory(req.authUser!.sub, body);
    return reply.code(201).send({ category });
  });

  app.patch("/admin/categories/:id", { preHandler: requireAuth(["admin"]) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = categoryUpdateSchema.parse(req.body);
    try {
      const category = await adminConfig.updateCategory(req.authUser!.sub, id, body);
      return reply.send({ category });
    } catch (err) {
      if (err instanceof CategoryNotFoundError) {
        return reply.code(404).send({ error: { code: "CATEGORY_NOT_FOUND", message: err.message } });
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
