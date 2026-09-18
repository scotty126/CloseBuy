import type { PrismaClient } from "@prisma/client";
import type { MonnifyClient } from "../payments/monnify.js";
import type { NotificationService } from "../notifications/service.js";
import { computeVendorBalance } from "./balance.js";

export class VendorProfileNotFoundError extends Error {
  constructor() {
    super("Vendor not found.");
  }
}

export class MissingBankDetailsError extends Error {
  constructor() {
    super("This vendor has no bank account on file yet.");
  }
}

export class InsufficientBalanceError extends Error {
  constructor() {
    super("Requested amount exceeds what's available to withdraw.");
  }
}

export class PayoutNotFoundError extends Error {
  constructor() {
    super("Payout not found.");
  }
}

export class InvalidPayoutStateError extends Error {
  constructor() {
    super("This payout has already been decided.");
  }
}

export interface PayoutServiceDeps {
  prisma: PrismaClient;
  monnify: MonnifyClient;
  notifications: NotificationService;
}

/**
 * Vendor-requested, admin-approved payouts (see the plan this was built
 * from: docs aren't kept for this, but the design reasoning — why payouts
 * stay out of the append-only ledger, why the Payout row is created before
 * the Monnify call, why balance-in-flight is reserved at request time — is
 * worth re-deriving from first principles if this file ever needs a
 * rewrite; it isn't obvious from the code alone).
 */
export function createPayoutService({ prisma, monnify, notifications }: PayoutServiceDeps) {
  async function writeAuditLog(actorId: string, action: string, targetType: string, targetId: string, reason?: string) {
    await prisma.auditLog.create({ data: { actorId, action, targetType, targetId, reason } });
  }

  async function requireVendorByUserId(vendorUserId: string) {
    const vendor = await prisma.vendorProfile.findUnique({ where: { userId: vendorUserId } });
    if (!vendor) throw new VendorProfileNotFoundError();
    return vendor;
  }

  function assertBankDetailsPresent(vendor: { bankAccountNumber: string | null; bankCode: string | null; bankAccountName: string | null }) {
    if (!vendor.bankAccountNumber || !vendor.bankCode || !vendor.bankAccountName) {
      throw new MissingBankDetailsError();
    }
  }

  return {
    /** Admin's view of a specific vendor's balance — same numbers `getMyBalance` returns, just addressed by vendorId instead of the caller's own session. */
    async getVendorBalance(vendorId: string) {
      const vendor = await prisma.vendorProfile.findUnique({ where: { id: vendorId } });
      if (!vendor) throw new VendorProfileNotFoundError();
      return computeVendorBalance(prisma, vendorId);
    },

    /** The vendor's own balance — GET /vendors/me/earnings folds this in too (order/service.ts), this is the standalone version used by the payout routes themselves. */
    async getMyBalance(vendorUserId: string) {
      const vendor = await requireVendorByUserId(vendorUserId);
      return computeVendorBalance(prisma, vendor.id);
    },

    /** The vendor's own request/payout history. */
    async listMyPayouts(vendorUserId: string) {
      const vendor = await requireVendorByUserId(vendorUserId);
      return prisma.payout.findMany({
        where: { payeeType: "vendor", payeeId: vendor.id },
        orderBy: { createdAt: "desc" },
      });
    },

    /**
     * Vendor asks to withdraw. Creates the `requested` row inside a
     * Serializable transaction that re-reads the balance first — this is
     * what actually prevents two rapid requests from both succeeding
     * against the same money; the ledger/Payout query in balance.ts alone
     * only protects against races if it runs inside this same isolation
     * level.
     */
    async requestPayout(vendorUserId: string, amountMinor?: number) {
      const vendor = await requireVendorByUserId(vendorUserId);
      assertBankDetailsPresent(vendor);

      const payout = await prisma.$transaction(
        async (tx) => {
          const balance = await computeVendorBalance(tx as PrismaClient, vendor.id);
          const requested = amountMinor ?? balance.availableToWithdrawMinor;
          if (requested <= 0 || requested > balance.availableToWithdrawMinor) {
            throw new InsufficientBalanceError();
          }
          return tx.payout.create({
            data: { payeeType: "vendor", payeeId: vendor.id, amountMinor: requested, status: "requested" },
          });
        },
        { isolationLevel: "Serializable" },
      );

      await writeAuditLog(vendorUserId, "vendor_payout_requested", "payout", payout.id);
      return payout;
    },

    /** Admin's approval queue — every `requested` payout, oldest first, with enough vendor context to review without a second round trip. */
    async listPendingRequests() {
      const payouts = await prisma.payout.findMany({
        where: { payeeType: "vendor", status: "requested" },
        orderBy: { createdAt: "asc" },
      });
      const vendors = await prisma.vendorProfile.findMany({
        where: { id: { in: payouts.map((p) => p.payeeId) } },
        select: { id: true, businessName: true },
      });
      const vendorById = new Map(vendors.map((v) => [v.id, v]));
      return payouts.map((p) => ({ ...p, vendor: vendorById.get(p.payeeId) ?? { id: p.payeeId, businessName: "(unknown)" } }));
    },

    /**
     * Admin approves — this is the only place `monnify.transfer()` is
     * called. The `requested` -> `scheduled` flip happens inside a short
     * DB-only transaction (never held open across the network call); the
     * transfer itself happens strictly after that commits, and the
     * resulting `paid`/`failed` update happens as a separate write after
     * that. A crash between the transfer call and this final update would
     * leave the row stuck `scheduled` rather than silently `paid` or lost
     * — a known, honest gap (see the plan's "Out of scope": no automatic
     * retry/reconciliation is built for that window).
     */
    async approvePayout(adminUserId: string, payoutId: string) {
      const scheduled = await prisma.$transaction(
        async (tx) => {
          const payout = await tx.payout.findUnique({ where: { id: payoutId } });
          if (!payout) throw new PayoutNotFoundError();
          if (payout.status !== "requested") throw new InvalidPayoutStateError();

          // This payout's own `requested` status already counts against
          // the balance (balance.ts), so a negative result here means the
          // vendor's true accrued balance dropped below what's reserved
          // since the request was made (e.g. a dispute clawed back an
          // order) — the defensive check this re-read exists for.
          const balance = await computeVendorBalance(tx as PrismaClient, payout.payeeId);
          if (balance.availableToWithdrawMinor < 0) {
            throw new InsufficientBalanceError();
          }
          return tx.payout.update({ where: { id: payoutId }, data: { status: "scheduled" } });
        },
        { isolationLevel: "Serializable" },
      );

      const vendor = await prisma.vendorProfile.findUnique({ where: { id: scheduled.payeeId } });
      if (!vendor) throw new VendorProfileNotFoundError();
      assertBankDetailsPresent(vendor);

      try {
        const result = await monnify.transfer({
          amountMinor: scheduled.amountMinor,
          destinationAccountNumber: vendor.bankAccountNumber!,
          destinationAccountName: vendor.bankAccountName!,
          destinationBankCode: vendor.bankCode!,
          narration: `CloseBuy payout — ${vendor.businessName}`,
          reference: scheduled.id,
        });

        if (result.status === "SUCCESS") {
          const paid = await prisma.payout.update({
            where: { id: payoutId },
            data: { status: "paid", processedAt: new Date(), reference: result.providerReference },
          });
          await writeAuditLog(adminUserId, "vendor_payout_paid", "payout", payoutId);
          await notifications.notify(vendor.userId, "payout_paid", { payoutId, amountMinor: paid.amountMinor });
          return paid;
        }

        const failureReason = result.status === "PENDING" ? "Monnify returned PENDING; verify manually before re-approving." : "Monnify reported the transfer failed.";
        const failed = await prisma.payout.update({
          where: { id: payoutId },
          data: { status: "failed", processedAt: new Date(), reference: result.providerReference, failureReason },
        });
        await writeAuditLog(adminUserId, "vendor_payout_failed", "payout", payoutId, failureReason);
        await notifications.notify(vendor.userId, "payout_failed", { payoutId, reason: failureReason });
        return failed;
      } catch (err) {
        const failureReason = err instanceof Error ? err.message : "Unknown error calling Monnify.";
        const failed = await prisma.payout.update({
          where: { id: payoutId },
          data: { status: "failed", processedAt: new Date(), failureReason },
        });
        await writeAuditLog(adminUserId, "vendor_payout_failed", "payout", payoutId, failureReason);
        await notifications.notify(vendor.userId, "payout_failed", { payoutId, reason: failureReason });
        return failed;
      }
    },

    /** Admin declines before any money moves — frees the reserved balance back up. */
    async rejectPayout(adminUserId: string, payoutId: string, reason: string) {
      const payout = await prisma.payout.findUnique({ where: { id: payoutId } });
      if (!payout) throw new PayoutNotFoundError();
      if (payout.status !== "requested") throw new InvalidPayoutStateError();

      const rejected = await prisma.payout.update({
        where: { id: payoutId },
        data: { status: "rejected", rejectionReason: reason },
      });
      await writeAuditLog(adminUserId, "vendor_payout_rejected", "payout", payoutId, reason);

      const vendor = await prisma.vendorProfile.findUnique({ where: { id: payout.payeeId } });
      if (vendor) {
        await notifications.notify(vendor.userId, "payout_rejected", { payoutId, reason });
      }
      return rejected;
    },
  };
}

export type PayoutService = ReturnType<typeof createPayoutService>;
