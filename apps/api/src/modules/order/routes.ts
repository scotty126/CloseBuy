import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import {
  checkoutSchema,
  rejectOrderSchema,
  confirmPickupSchema,
  rateOrderSchema,
  disputeOrderSchema,
} from "@closebuy/types";
import { requireAuth } from "../../lib/auth-guard.js";
import { createMonnifyClient, type WebhookEvent } from "../payments/monnify.js";
import { createOrderQueue, startOrderWorker } from "./jobs.js";
import {
  createOrderService,
  VendorUnavailableError,
  OutsideServiceAreaError,
  CartInvalidError,
  OrderNotFoundError,
  ForbiddenError,
  InvalidOrderStateError,
  InvalidCollectionCodeError,
  VendorProfileNotFoundError,
} from "./service.js";

/**
 * Order & Checkout — the biggest module in M1 (roadmap.md). Dispatch
 * (rider job offer/accept, delivery confirmation) is a deliberately
 * separate concern and isn't wired up yet: a delivery order can reach
 * READY_FOR_PICKUP here and then correctly waits, rather than pretending
 * to progress further. Pickup orders complete fully without it.
 */
export async function orderRoutes(app: FastifyInstance) {
  const monnify = createMonnifyClient(app.env.MONNIFY_API_KEY, app.env.MONNIFY_SECRET_KEY, app.env.MONNIFY_CONTRACT_CODE, app.env.NODE_ENV);
  const queue = createOrderQueue(app.env.REDIS_URL);
  const order = createOrderService({
    prisma: app.prisma,
    monnify,
    queue,
    notifications: app.notifications,
    customerAppUrl: app.env.CUSTOMER_APP_URL,
  });

  // Started once, alongside route registration — the worker processes
  // timer-fired jobs by calling back into the same service instance
  // (jobs.ts takes callbacks rather than importing this file, so the two
  // modules don't import each other).
  const worker = startOrderWorker(app.env.REDIS_URL, {
    onAutoReject: (orderId) => order.autoRejectOrder(orderId),
    onEscrowRelease: (orderId) => order.releaseEscrow(orderId),
  });
  app.addHook("onClose", async () => {
    await worker.close();
    await queue.close();
  });

  // ── Checkout ────────────────────────────────────────────────────────

  app.post("/checkout", async (req, reply) => {
    const idempotencyKey = (req.headers["idempotency-key"] as string | undefined) ?? randomUUID();
    const body = checkoutSchema.parse(req.body);

    // Session is optional here (brief §3.1b) — a bearer token is honoured
    // if present, but its absence is not an error, unlike requireAuth().
    const authHeader = req.headers.authorization;
    let auth: { sub: string; role: string } | null = null;
    if (authHeader?.startsWith("Bearer ")) {
      try {
        const { verifyAccessToken } = await import("../../lib/jwt.js");
        auth = verifyAccessToken(authHeader.slice(7), app.env.JWT_ACCESS_SECRET);
      } catch {
        // An expired/invalid token on an optional-auth endpoint degrades
        // to guest checkout rather than failing the request outright.
      }
    }

    try {
      const result = await order.checkout(body, auth, idempotencyKey);
      return reply.code(201).send(result);
    } catch (err) {
      if (err instanceof VendorUnavailableError) {
        return reply.code(422).send({ error: { code: "VENDOR_UNAVAILABLE", message: err.message } });
      }
      if (err instanceof OutsideServiceAreaError) {
        return reply.code(422).send({ error: { code: "OUTSIDE_SERVICE_AREA", message: err.message } });
      }
      if (err instanceof CartInvalidError) {
        return reply.code(409).send({ error: { code: "CART_INVALID", message: err.message } });
      }
      throw err;
    }
  });

  // Registered in its own encapsulated scope so only this route gets a
  // raw-string body parser — signature verification (Monnify client) needs
  // the exact bytes Monnify sent, not Fastify's re-serialized JSON, since
  // the HMAC won't match otherwise.
  app.register(async (scoped) => {
    scoped.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
      done(null, body);
    });

    scoped.post("/webhooks/monnify", async (req, reply) => {
      const rawBody = req.body as string;
      const signature = req.headers["monnify-signature"] as string | undefined;

      if (!monnify.verifyWebhookSignature(rawBody, signature)) {
        req.log.warn("Rejected Monnify webhook with invalid signature");
        return reply.code(401).send({ error: { code: "INVALID_SIGNATURE", message: "Signature verification failed." } });
      }

      const event = JSON.parse(rawBody) as WebhookEvent;
      await order.handleMonnifyWebhook(event);
      return reply.code(200).send({ received: true }); // ack fast, per Monnify's own guidance — see monnify.ts
    });
  });

  // ── Order status ────────────────────────────────────────────────────

  app.get("/orders/track/:trackingToken", async (req, reply) => {
    const { trackingToken } = req.params as { trackingToken: string };
    try {
      return reply.send({ order: await order.getOrderByTrackingToken(trackingToken) });
    } catch (err) {
      if (err instanceof OrderNotFoundError) {
        return reply.code(404).send({ error: { code: "ORDER_NOT_FOUND", message: err.message } });
      }
      throw err;
    }
  });

  app.post("/orders/track/:trackingToken/rate", async (req, reply) => {
    const { trackingToken } = req.params as { trackingToken: string };
    const body = rateOrderSchema.parse(req.body);
    const target = await order.getOrderByTrackingToken(trackingToken);
    const rating = await order.rateOrder(target.id, body, target.customerId);
    return reply.code(201).send({ rating });
  });

  app.post("/orders/track/:trackingToken/dispute", async (req, reply) => {
    const { trackingToken } = req.params as { trackingToken: string };
    const body = disputeOrderSchema.parse(req.body);
    const target = await order.getOrderByTrackingToken(trackingToken);
    const dispute = await order.disputeOrder(target.id, body, target.customerId);
    return reply.code(201).send({ dispute });
  });

  app.get("/orders", { preHandler: requireAuth(["customer"]) }, async (req, reply) => {
    return reply.send({ orders: await order.listCustomerOrders(req.authUser!.sub) });
  });

  app.get(
    "/orders/:id",
    { preHandler: requireAuth(["customer", "vendor", "rider"]) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      try {
        return reply.send({ order: await order.getOrder(id, req.authUser!) });
      } catch (err) {
        if (err instanceof OrderNotFoundError) {
          return reply.code(404).send({ error: { code: "ORDER_NOT_FOUND", message: err.message } });
        }
        if (err instanceof ForbiddenError) {
          return reply.code(403).send({ error: { code: "FORBIDDEN", message: err.message } });
        }
        throw err;
      }
    },
  );

  app.post("/orders/:id/rate", { preHandler: requireAuth(["customer"]) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = rateOrderSchema.parse(req.body);
    const customer = await app.prisma.customerProfile.findUnique({ where: { userId: req.authUser!.sub } });
    const rating = await order.rateOrder(id, body, customer?.id ?? null);
    return reply.code(201).send({ rating });
  });

  app.post("/orders/:id/dispute", { preHandler: requireAuth(["customer"]) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = disputeOrderSchema.parse(req.body);
    const customer = await app.prisma.customerProfile.findUnique({ where: { userId: req.authUser!.sub } });
    const dispute = await order.disputeOrder(id, body, customer?.id ?? null);
    return reply.code(201).send({ dispute });
  });

  app.post("/orders/:id/cancel", { preHandler: requireAuth(["customer"]) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      await order.cancelOrder(req.authUser!, id);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof InvalidOrderStateError) {
        return reply.code(422).send({ error: { code: "INVALID_STATE", message: err.message } });
      }
      if (err instanceof ForbiddenError || err instanceof OrderNotFoundError) {
        return reply.code(404).send({ error: { code: "ORDER_NOT_FOUND", message: "Order not found." } });
      }
      throw err;
    }
  });

  // ── Vendor actions ──────────────────────────────────────────────────

  app.get("/vendors/me/orders", { preHandler: requireAuth(["vendor"]) }, async (req, reply) => {
    try {
      return reply.send({ orders: await order.listVendorOrders(req.authUser!.sub) });
    } catch (err) {
      if (err instanceof VendorProfileNotFoundError) {
        return reply.code(404).send({ error: { code: "VENDOR_NOT_FOUND", message: err.message } });
      }
      throw err;
    }
  });

  app.get("/vendors/me/earnings", { preHandler: requireAuth(["vendor"]) }, async (req, reply) => {
    try {
      return reply.send(await order.getVendorEarnings(req.authUser!.sub));
    } catch (err) {
      if (err instanceof VendorProfileNotFoundError) {
        return reply.code(404).send({ error: { code: "VENDOR_NOT_FOUND", message: err.message } });
      }
      throw err;
    }
  });

  const vendorOrderAction = (
    handler: (vendorUserId: string, orderId: string, body: unknown) => Promise<unknown>,
  ) =>
    async (req: any, reply: any) => {
      const { id } = req.params as { id: string };
      try {
        const result = await handler(req.authUser!.sub, id, req.body);
        return reply.send(result ?? {});
      } catch (err) {
        if (err instanceof OrderNotFoundError) {
          return reply.code(404).send({ error: { code: "ORDER_NOT_FOUND", message: err.message } });
        }
        if (err instanceof InvalidOrderStateError) {
          return reply.code(422).send({ error: { code: "INVALID_STATE", message: err.message } });
        }
        if (err instanceof InvalidCollectionCodeError) {
          return reply.code(400).send({ error: { code: "INVALID_CODE", message: err.message } });
        }
        throw err;
      }
    };

  app.post(
    "/orders/:id/accept",
    { preHandler: requireAuth(["vendor"]) },
    vendorOrderAction(async (userId, id) => {
      await order.acceptOrder(userId, id);
    }),
  );

  app.post(
    "/orders/:id/reject",
    { preHandler: requireAuth(["vendor"]) },
    vendorOrderAction(async (userId, id, body) => {
      await order.rejectOrder(userId, id, rejectOrderSchema.parse(body));
    }),
  );

  app.post(
    "/orders/:id/ready",
    { preHandler: requireAuth(["vendor"]) },
    vendorOrderAction(async (userId, id) => {
      await order.markReady(userId, id);
    }),
  );

  app.post(
    "/orders/:id/confirm-pickup",
    { preHandler: requireAuth(["vendor"]) },
    vendorOrderAction(async (userId, id, body) => {
      await order.confirmCustomerPickup(userId, id, confirmPickupSchema.parse(body));
    }),
  );
}
