import type { FastifyInstance } from "fastify";
import { payoutRequestSchema, payoutRejectSchema } from "@closebuy/types";
import { requireAuth } from "../../lib/auth-guard.js";
import { createMonnifyClient } from "../payments/monnify.js";
import {
  createPayoutService,
  VendorProfileNotFoundError,
  MissingBankDetailsError,
  InsufficientBalanceError,
  PayoutNotFoundError,
  InvalidPayoutStateError,
} from "./service.js";

/**
 * Vendor-requested, admin-approved payouts. Vendors see their balance and
 * ask for a withdrawal; admin reviews each request and is the only path
 * that actually moves money (Monnify's disbursement API) — a deliberate
 * human check while vendor-supplied bank details are self-reported and
 * unverified. See payouts/service.ts for the full design reasoning.
 */
export async function payoutRoutes(app: FastifyInstance) {
  const monnify = createMonnifyClient(
    app.env.MONNIFY_API_KEY,
    app.env.MONNIFY_SECRET_KEY,
    app.env.MONNIFY_CONTRACT_CODE,
    app.env.NODE_ENV,
    app.env.MONNIFY_DISBURSEMENT_SOURCE_ACCOUNT_NUMBER,
  );
  const payouts = createPayoutService({ prisma: app.prisma, monnify, notifications: app.notifications });

  // ── Vendor-facing ──────────────────────────────────────────────────

  app.get("/vendors/me/payouts", { preHandler: requireAuth(["vendor"]) }, async (req, reply) => {
    try {
      const payouts_ = await payouts.listMyPayouts(req.authUser!.sub);
      return reply.send({ payouts: payouts_ });
    } catch (err) {
      if (err instanceof VendorProfileNotFoundError) {
        return reply.code(404).send({ error: { code: "VENDOR_NOT_FOUND", message: err.message } });
      }
      throw err;
    }
  });

  app.post("/vendors/me/payouts/request", { preHandler: requireAuth(["vendor"]) }, async (req, reply) => {
    const body = payoutRequestSchema.parse(req.body);
    try {
      const payout = await payouts.requestPayout(req.authUser!.sub, body.amountMinor);
      return reply.code(201).send({ payout });
    } catch (err) {
      if (err instanceof VendorProfileNotFoundError) {
        return reply.code(404).send({ error: { code: "VENDOR_NOT_FOUND", message: err.message } });
      }
      if (err instanceof MissingBankDetailsError) {
        return reply.code(422).send({ error: { code: "MISSING_BANK_DETAILS", message: err.message } });
      }
      if (err instanceof InsufficientBalanceError) {
        return reply.code(422).send({ error: { code: "INSUFFICIENT_BALANCE", message: err.message } });
      }
      throw err;
    }
  });

  // ── Admin-facing ───────────────────────────────────────────────────

  app.get("/admin/payouts/requests", { preHandler: requireAuth(["admin"]) }, async (_req, reply) => {
    return reply.send({ requests: await payouts.listPendingRequests() });
  });

  app.get("/admin/payouts/vendors/:vendorId/balance", { preHandler: requireAuth(["admin"]) }, async (req, reply) => {
    const { vendorId } = req.params as { vendorId: string };
    try {
      const balance = await payouts.getVendorBalance(vendorId);
      return reply.send({ balance });
    } catch (err) {
      if (err instanceof VendorProfileNotFoundError) {
        return reply.code(404).send({ error: { code: "VENDOR_NOT_FOUND", message: err.message } });
      }
      throw err;
    }
  });

  app.post("/admin/payouts/:payoutId/approve", { preHandler: requireAuth(["admin"]) }, async (req, reply) => {
    const { payoutId } = req.params as { payoutId: string };
    try {
      const payout = await payouts.approvePayout(req.authUser!.sub, payoutId);
      if (payout.status === "failed") {
        return reply.code(502).send({ error: { code: "PAYOUT_FAILED", message: payout.failureReason, payoutId: payout.id } });
      }
      return reply.send({ payout });
    } catch (err) {
      if (err instanceof PayoutNotFoundError) {
        return reply.code(404).send({ error: { code: "PAYOUT_NOT_FOUND", message: err.message } });
      }
      if (err instanceof InvalidPayoutStateError) {
        return reply.code(409).send({ error: { code: "ALREADY_DECIDED", message: err.message } });
      }
      if (err instanceof InsufficientBalanceError) {
        return reply.code(422).send({ error: { code: "INSUFFICIENT_BALANCE", message: err.message } });
      }
      if (err instanceof MissingBankDetailsError) {
        return reply.code(422).send({ error: { code: "MISSING_BANK_DETAILS", message: err.message } });
      }
      throw err;
    }
  });

  app.post("/admin/payouts/:payoutId/reject", { preHandler: requireAuth(["admin"]) }, async (req, reply) => {
    const { payoutId } = req.params as { payoutId: string };
    const body = payoutRejectSchema.parse(req.body);
    try {
      const payout = await payouts.rejectPayout(req.authUser!.sub, payoutId, body.reason);
      return reply.send({ payout });
    } catch (err) {
      if (err instanceof PayoutNotFoundError) {
        return reply.code(404).send({ error: { code: "PAYOUT_NOT_FOUND", message: err.message } });
      }
      if (err instanceof InvalidPayoutStateError) {
        return reply.code(409).send({ error: { code: "ALREADY_DECIDED", message: err.message } });
      }
      throw err;
    }
  });
}
