import type { PrismaClient } from "@prisma/client";

/**
 * A vendor's payable balance never lives in one place — `vendor_payable`
 * ledger credits (order/ledger.ts's `escrowReleaseEntries`, posted per
 * order as escrow releases) say what's been earned; `Payout` rows say
 * what's been requested/sent. This is the one function that combines them,
 * imported by both the vendor-facing balance view and the payout-request
 * validation, so those two can never drift apart from each other.
 *
 * `requested`/`scheduled`/`paid` Payout rows all count against the
 * balance — an in-flight request reserves the money the moment it's
 * created, before any admin action or Monnify call. `failed`/`rejected`
 * don't: the money never actually moved (or was explicitly released back).
 *
 * `availableToWithdrawMinor` is deliberately NOT clamped to zero — a
 * negative value is a real signal (e.g. a dispute clawed back an order's
 * vendor_payable credit after a payout against it was already requested)
 * that callers need to see, not hide. requestPayout's `> available` check
 * and approvePayout's defensive re-check both rely on this being exact.
 */
export interface VendorBalance {
  vendorId: string;
  accruedMinor: number;
  reservedOrPaidMinor: number;
  availableToWithdrawMinor: number;
}

export async function computeVendorBalance(prisma: PrismaClient, vendorId: string): Promise<VendorBalance> {
  const [credited, debited, reservedOrPaid] = await Promise.all([
    prisma.ledgerEntry.aggregate({
      where: { account: "vendor_payable", direction: "credit", order: { vendorId } },
      _sum: { amountMinor: true },
    }),
    prisma.ledgerEntry.aggregate({
      where: { account: "vendor_payable", direction: "debit", order: { vendorId } },
      _sum: { amountMinor: true },
    }),
    prisma.payout.aggregate({
      where: { payeeType: "vendor", payeeId: vendorId, status: { in: ["requested", "scheduled", "paid"] } },
      _sum: { amountMinor: true },
    }),
  ]);

  const accruedMinor = (credited._sum.amountMinor ?? 0) - (debited._sum.amountMinor ?? 0);
  const reservedOrPaidMinor = reservedOrPaid._sum.amountMinor ?? 0;

  return {
    vendorId,
    accruedMinor,
    reservedOrPaidMinor,
    availableToWithdrawMinor: accruedMinor - reservedOrPaidMinor,
  };
}
