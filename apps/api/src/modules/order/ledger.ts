import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * Double-entry, append-only (data-model.md §4/§6 invariant 2). Every
 * function here returns a *balanced* set of rows — debits sum to credits
 * — and the caller is expected to write them inside the same transaction
 * as the order-status change they accompany, so the ledger and the order
 * state can never drift out of sync with each other.
 */

type LedgerRow = { orderId: string; account: string; direction: "debit" | "credit"; amountMinor: number };

function assertBalanced(rows: LedgerRow[]) {
  const debits = rows.filter((r) => r.direction === "debit").reduce((s, r) => s + r.amountMinor, 0);
  const credits = rows.filter((r) => r.direction === "credit").reduce((s, r) => s + r.amountMinor, 0);
  if (debits !== credits) {
    // A ledger entry set that doesn't balance is a bug, not a business
    // exception — fail loudly rather than silently write inconsistent books.
    throw new Error(`Ledger entries do not balance: debits=${debits} credits=${credits}`);
  }
}

/** Payment succeeds (Monnify webhook, or immediately for cash on delivery) — funds move into escrow. */
export function escrowHoldEntries(orderId: string, totalMinor: number): LedgerRow[] {
  const rows: LedgerRow[] = [
    { orderId, account: "platform_clearing", direction: "debit", amountMinor: totalMinor },
    { orderId, account: "customer_escrow", direction: "credit", amountMinor: totalMinor },
  ];
  assertBalanced(rows);
  return rows;
}

export interface EscrowSplit {
  commissionMinor: number;
  deliveryFeeMinor: number; // 0 for pickup
  vendorNetMinor: number;
}

/** Given the order's totals and the commission rate that applied, computes the three-way split — pure function, no side effects, so it's trivially testable on its own. */
export function computeEscrowSplit(totalMinor: number, deliveryFeeMinor: number, commissionRatePercent: number): EscrowSplit {
  const goodsMinor = totalMinor - deliveryFeeMinor;
  const commissionMinor = Math.round((goodsMinor * commissionRatePercent) / 100);
  const vendorNetMinor = goodsMinor - commissionMinor;
  return { commissionMinor, deliveryFeeMinor, vendorNetMinor };
}

/** Order reaches COMPLETED (brief §4 — no dispute within the window) — escrow releases to its three destinations. */
export function escrowReleaseEntries(orderId: string, totalMinor: number, split: EscrowSplit): LedgerRow[] {
  const rows: LedgerRow[] = [
    { orderId, account: "customer_escrow", direction: "debit", amountMinor: totalMinor },
    { orderId, account: "vendor_payable", direction: "credit", amountMinor: split.vendorNetMinor },
    { orderId, account: "platform_commission", direction: "credit", amountMinor: split.commissionMinor },
  ];
  if (split.deliveryFeeMinor > 0) {
    rows.push({ orderId, account: "rider_payable", direction: "credit", amountMinor: split.deliveryFeeMinor });
  }
  assertBalanced(rows);
  return rows;
}

/** A refund — full amount, reversing the hold. Used on vendor rejection, self-service cancellation, and (later) admin-forced refunds. */
export function refundEntries(orderId: string, totalMinor: number): LedgerRow[] {
  const rows: LedgerRow[] = [
    { orderId, account: "customer_escrow", direction: "debit", amountMinor: totalMinor },
    { orderId, account: "platform_clearing", direction: "credit", amountMinor: totalMinor },
  ];
  assertBalanced(rows);
  return rows;
}

export async function postLedgerEntries(
  tx: Prisma.TransactionClient | PrismaClient,
  rows: LedgerRow[],
): Promise<void> {
  await tx.ledgerEntry.createMany({ data: rows as any });
}
