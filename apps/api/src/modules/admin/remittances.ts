import type { PrismaClient } from "@prisma/client";
import type { NotificationService } from "../notifications/service.js";
import type { RecordRemittanceInput } from "@closebuy/types";

/**
 * US-R-08 — an admin records cash a rider has physically handed back, and
 * the rider's balance drops immediately. Own module, same precedent as
 * ./orders.js / ./disputes.js / ./actors.js.
 *
 * Tracked in its own table rather than as ledger entries — see the comment
 * on `RiderCashRemittance` in schema.prisma (ledger_entries.orderId is NOT
 * NULL and a remittance belongs to no order; Payout is the same shape of
 * exception). US-A-05's reconciliation will need to fold these in
 * alongside the ledger's `rider_cash_float` total, the same way it will
 * for payouts.
 */

export class RiderNotFoundError extends Error {
  constructor() {
    super("Rider not found.");
  }
}

export class RemittanceExceedsBalanceError extends Error {
  constructor(public readonly balanceMinor: number) {
    super(
      `This rider only owes ₦${(balanceMinor / 100).toFixed(2)} — a remittance can't be larger than what's outstanding. ` +
        "If the amount is right, the balance may already have been cleared by an earlier entry.",
    );
  }
}

export interface AdminRemittanceServiceDeps {
  prisma: PrismaClient;
  notifications: NotificationService;
}

export function createAdminRemittanceService({ prisma, notifications }: AdminRemittanceServiceDeps) {
  return {
    /**
     * The decrement is a guarded `updateMany` (`cashBalanceMinor >= amount`),
     * not read-then-write: a COD delivery confirming at the same moment
     * increments the same counter, and two admins recording the same
     * handback twice must not both succeed. Row, balance change and audit
     * entry commit together or not at all.
     */
    async recordRemittance(adminUserId: string, riderId: string, input: RecordRemittanceInput) {
      const remittance = await prisma.$transaction(async (tx) => {
        const rider = await tx.riderProfile.findUnique({ where: { id: riderId } });
        if (!rider) throw new RiderNotFoundError();

        const { count } = await tx.riderProfile.updateMany({
          where: { id: riderId, cashBalanceMinor: { gte: input.amountMinor } },
          data: { cashBalanceMinor: { decrement: input.amountMinor } },
        });
        if (count === 0) throw new RemittanceExceedsBalanceError(rider.cashBalanceMinor);

        const created = await tx.riderCashRemittance.create({
          data: { riderId, amountMinor: input.amountMinor, recordedBy: adminUserId, note: input.note },
        });
        await tx.auditLog.create({
          data: {
            actorId: adminUserId,
            action: "rider_cash_remitted",
            targetType: "rider_profile",
            targetId: riderId,
            reason: `₦${(input.amountMinor / 100).toFixed(2)}${input.note ? ` — ${input.note}` : ""}`,
          },
        });
        return created;
      });

      const rider = await prisma.riderProfile.findUniqueOrThrow({ where: { id: riderId } });
      await notifications.notify(rider.userId, "rider_cash_remitted", {
        riderId,
        amountMinor: input.amountMinor,
        balanceMinor: rider.cashBalanceMinor,
      });
      return { rider, remittance };
    },

    /** Every remittance for one rider, newest first — so an admin can see what's already been recorded before entering another. */
    async listRemittances(riderId: string) {
      const rider = await prisma.riderProfile.findUnique({ where: { id: riderId } });
      if (!rider) throw new RiderNotFoundError();
      return prisma.riderCashRemittance.findMany({ where: { riderId }, orderBy: { createdAt: "desc" }, take: 100 });
    },
  };
}

export type AdminRemittanceService = ReturnType<typeof createAdminRemittanceService>;
