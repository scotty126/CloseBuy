import type { FastifyInstance } from "fastify";
import {
  riderApplicationSchema,
  setDutySchema,
  confirmCollectionSchema,
  confirmDeliverySchema,
  deliveryFailedSchema,
} from "@closebuy/types";
import { requireAuth } from "../../lib/auth-guard.js";
import { createOrderQueue } from "../order/jobs.js";
import {
  createDispatchService,
  RiderAlreadyExistsError,
  RiderNotFoundError,
  JobUnavailableError,
  OrderNotFoundError,
  InvalidCollectionCodeError,
  InvalidDeliveryCodeError,
  CashAmountMismatchError,
  CashFloatLimitError,
} from "./service.js";

/**
 * Dispatch — rider job offer/accept, pickup/delivery confirmation
 * (US-R-01 through 07). Completes the order lifecycle for delivery
 * orders, which sat at READY_FOR_PICKUP after Order & Checkout.
 *
 * Its own `OrderQueue` instance, pointed at the same Redis-backed BullMQ
 * queue Order/Checkout uses (order/jobs.ts) — safe, standard BullMQ usage
 * (multiple producer instances against one named queue), and avoids
 * threading a shared instance across the module boundary from app.ts.
 */
export async function dispatchRoutes(app: FastifyInstance) {
  const queue = createOrderQueue(app.env.REDIS_URL);
  const dispatch = createDispatchService({ prisma: app.prisma, queue, notifications: app.notifications });
  app.addHook("onClose", async () => {
    await queue.close();
  });

  app.post("/riders", { preHandler: requireAuth(["rider"]) }, async (req, reply) => {
    const body = riderApplicationSchema.parse(req.body);
    try {
      const rider = await dispatch.applyToRide(req.authUser!.sub, body);
      return reply.code(201).send({ rider });
    } catch (err) {
      if (err instanceof RiderAlreadyExistsError) {
        return reply.code(409).send({ error: { code: "RIDER_EXISTS", message: err.message } });
      }
      throw err;
    }
  });

  app.get("/riders/me", { preHandler: requireAuth(["rider"]) }, async (req, reply) => {
    try {
      return reply.send({ rider: await dispatch.getOwnProfile(req.authUser!.sub) });
    } catch (err) {
      if (err instanceof RiderNotFoundError) {
        return reply.code(404).send({ error: { code: "RIDER_NOT_FOUND", message: err.message } });
      }
      throw err;
    }
  });

  app.patch("/riders/me/duty", { preHandler: requireAuth(["rider"]) }, async (req, reply) => {
    const body = setDutySchema.parse(req.body);
    try {
      const rider = await dispatch.setDuty(req.authUser!.sub, body);
      return reply.send({ rider });
    } catch (err) {
      if (err instanceof RiderNotFoundError) {
        return reply.code(403).send({ error: { code: "RIDER_NOT_APPROVED", message: "Your application needs to be approved before you can go on duty." } });
      }
      throw err;
    }
  });

  app.get("/riders/me/offers", { preHandler: requireAuth(["rider"]) }, async (req, reply) => {
    return reply.send({ offers: await dispatch.listOpenJobs(req.authUser!.sub) });
  });

  app.get("/riders/me/active-job", { preHandler: requireAuth(["rider"]) }, async (req, reply) => {
    return reply.send({ order: await dispatch.getActiveJob(req.authUser!.sub) });
  });

  app.post("/riders/me/offers/:id/accept", { preHandler: requireAuth(["rider"]) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const order = await dispatch.claimJob(req.authUser!.sub, id);
      return reply.send({ order });
    } catch (err) {
      if (err instanceof CashFloatLimitError) {
        return reply.code(409).send({ error: { code: "CASH_FLOAT_LIMIT", message: err.message } });
      }
      if (err instanceof JobUnavailableError) {
        return reply.code(409).send({ error: { code: "JOB_UNAVAILABLE", message: err.message } });
      }
      throw err;
    }
  });

  app.post("/riders/me/offers/:id/decline", { preHandler: requireAuth(["rider"]) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await dispatch.declineJob(req.authUser!.sub, id);
    return reply.code(204).send();
  });

  app.post("/orders/:id/confirm-collection", { preHandler: requireAuth(["rider"]) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = confirmCollectionSchema.parse(req.body);
    try {
      const order = await dispatch.confirmCollection(req.authUser!.sub, id, body);
      return reply.send({ order });
    } catch (err) {
      if (err instanceof OrderNotFoundError) {
        return reply.code(404).send({ error: { code: "ORDER_NOT_FOUND", message: err.message } });
      }
      if (err instanceof JobUnavailableError) {
        return reply.code(422).send({ error: { code: "INVALID_STATE", message: err.message } });
      }
      if (err instanceof InvalidCollectionCodeError) {
        return reply.code(400).send({ error: { code: "INVALID_CODE", message: err.message } });
      }
      throw err;
    }
  });

  app.post("/orders/:id/confirm-delivery", { preHandler: requireAuth(["rider"]) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = confirmDeliverySchema.parse(req.body);
    try {
      const order = await dispatch.confirmDelivery(req.authUser!.sub, id, body);
      return reply.send({ order });
    } catch (err) {
      if (err instanceof OrderNotFoundError) {
        return reply.code(404).send({ error: { code: "ORDER_NOT_FOUND", message: err.message } });
      }
      if (err instanceof JobUnavailableError) {
        return reply.code(422).send({ error: { code: "INVALID_STATE", message: err.message } });
      }
      if (err instanceof InvalidDeliveryCodeError) {
        return reply.code(400).send({ error: { code: "INVALID_DELIVERY_CODE", message: err.message } });
      }
      if (err instanceof CashAmountMismatchError) {
        return reply.code(400).send({ error: { code: "CASH_MISMATCH", message: err.message } });
      }
      throw err;
    }
  });

  app.post("/orders/:id/delivery-failed", { preHandler: requireAuth(["rider"]) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = deliveryFailedSchema.parse(req.body);
    try {
      const order = await dispatch.reportDeliveryFailed(req.authUser!.sub, id, body);
      return reply.send({ order });
    } catch (err) {
      if (err instanceof OrderNotFoundError) {
        return reply.code(404).send({ error: { code: "ORDER_NOT_FOUND", message: err.message } });
      }
      if (err instanceof JobUnavailableError) {
        return reply.code(422).send({ error: { code: "INVALID_STATE", message: err.message } });
      }
      throw err;
    }
  });

  app.get("/riders/me/earnings", { preHandler: requireAuth(["rider"]) }, async (req, reply) => {
    return reply.send(await dispatch.getEarnings(req.authUser!.sub));
  });

  // US-R-08 — read-only for the rider. Recording a remittance is an admin
  // action (POST /admin/riders/:id/remittances, admin/remittances.ts): the
  // story says an admin records it, and a rider who could log their own
  // handback would just be editing their own debt.
  app.get("/riders/me/remittances", { preHandler: requireAuth(["rider"]) }, async (req, reply) => {
    return reply.send({ remittances: await dispatch.listRemittances(req.authUser!.sub) });
  });
}
