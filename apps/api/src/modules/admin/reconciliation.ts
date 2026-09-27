import type { PrismaClient } from "@prisma/client";
import { LEDGER_ACCOUNTS } from "@closebuy/types";
import type { LedgerAccount, PayoutStatus, ReconciliationDiscrepancy, ReconciliationReportDto } from "@closebuy/types";

export interface ReconciliationServiceDeps {
  prisma: PrismaClient;
  /** Whether MONNIFY_API_KEY/SECRET_KEY/CONTRACT_CODE are all set — decides the wording of the (always-unavailable-for-now) gatewaySettlement field, not whether the rest of the report runs. */
  monnifyConfigured: boolean;
}

/**
 * US-A-05's other half. Every individual ledger write is already
 * balance-asserted at the source (order/ledger.ts's assertBalanced), so a
 * platform-wide debit/credit mismatch should be structurally impossible —
 * checking it anyway is cheap and catches the one thing that assertion
 * can't: something writing to `ledger_entries` outside the normal code
 * paths. The two checks that actually earn their keep are per-payee: has a
 * vendor ever been paid more than the ledger credited them, and does a
 * rider's live `cashBalanceMinor` actually equal what they've collected
 * minus what they've handed back. Both are real bug classes this
 * genuinely could have (the second one especially — `confirmDelivery`,
 * dispatch/service.ts, posts the COD ledger entry and increments
 * `cashBalanceMinor` as two separate statements, not one transaction; a
 * crash between them would show up here as exactly this mismatch. Known,
 * documented in CLAUDE.md, not yet fixed).
 */
export function createAdminReconciliationService({ prisma, monnifyConfigured }: ReconciliationServiceDeps) {
  return {
    async getReport(): Promise<ReconciliationReportDto> {
      const [ledgerByAccount, discrepancies, payoutTotals, remittanceTotal] = await Promise.all([
        getLedgerTotals(prisma),
        findDiscrepancies(prisma),
        getPayoutTotals(prisma),
        prisma.riderCashRemittance.aggregate({ _sum: { amountMinor: true } }),
      ]);

      return {
        generatedAt: new Date().toISOString(),
        ledgerByAccount,
        payoutTotals,
        remittanceTotalMinor: remittanceTotal._sum.amountMinor ?? 0,
        discrepancies,
        gatewaySettlement: {
          available: false,
          configured: monnifyConfigured,
          reason: monnifyConfigured
            ? "Monnify credentials are set, but fetching its settlement report isn't built yet — that's the next real piece here, once real online payments exist to reconcile."
            : "Monnify isn't configured (no API key/secret/contract code) — cash on delivery is the only real payment method right now, so there's no gateway settlement to compare against.",
        },
      };
    },
  };
}

async function getLedgerTotals(prisma: PrismaClient): Promise<ReconciliationReportDto["ledgerByAccount"]> {
  const grouped = await prisma.ledgerEntry.groupBy({ by: ["account", "direction"], _sum: { amountMinor: true } });
  const totals = new Map<LedgerAccount, { creditMinor: number; debitMinor: number }>(
    LEDGER_ACCOUNTS.map((a) => [a, { creditMinor: 0, debitMinor: 0 }]),
  );
  for (const row of grouped) {
    const entry = totals.get(row.account as LedgerAccount);
    if (!entry) continue; // defensive — a schema account this module doesn't know about yet, rather than throwing
    const amount = row._sum.amountMinor ?? 0;
    if (row.direction === "credit") entry.creditMinor = amount;
    else entry.debitMinor = amount;
  }
  return LEDGER_ACCOUNTS.map((account) => {
    const { creditMinor, debitMinor } = totals.get(account)!;
    return { account, creditMinor, debitMinor, netMinor: creditMinor - debitMinor };
  });
}

async function getPayoutTotals(prisma: PrismaClient): Promise<ReconciliationReportDto["payoutTotals"]> {
  const grouped = await prisma.payout.groupBy({ by: ["status"], _sum: { amountMinor: true }, _count: true });
  const totals: ReconciliationReportDto["payoutTotals"] = {};
  for (const row of grouped) {
    totals[row.status as PayoutStatus] = { count: row._count, amountMinor: row._sum.amountMinor ?? 0 };
  }
  return totals;
}

async function findDiscrepancies(prisma: PrismaClient): Promise<ReconciliationDiscrepancy[]> {
  const discrepancies: ReconciliationDiscrepancy[] = [];

  // ── Global: should be structurally impossible — see the module doc above. ──
  const [debitSum, creditSum] = await Promise.all([
    prisma.ledgerEntry.aggregate({ where: { direction: "debit" }, _sum: { amountMinor: true } }),
    prisma.ledgerEntry.aggregate({ where: { direction: "credit" }, _sum: { amountMinor: true } }),
  ]);
  const totalDebitMinor = debitSum._sum.amountMinor ?? 0;
  const totalCreditMinor = creditSum._sum.amountMinor ?? 0;
  if (totalDebitMinor !== totalCreditMinor) {
    discrepancies.push({
      type: "unbalanced_ledger",
      message: "The ledger's total debits and total credits don't match. Every write is balance-asserted at the source (order/ledger.ts) — this should be impossible, so something wrote to ledger_entries outside the normal code paths. Investigate immediately.",
      details: { totalDebitMinor, totalCreditMinor, differenceMinor: totalDebitMinor - totalCreditMinor },
    });
  }

  // ── Per vendor: never paid out more than the ledger ever credited them. ──
  const vendorPayableEntries = await prisma.ledgerEntry.findMany({
    where: { account: "vendor_payable" },
    select: { direction: true, amountMinor: true, order: { select: { vendorId: true } } },
  });
  const vendorAccruedMinor = new Map<string, number>();
  for (const e of vendorPayableEntries) {
    const delta = e.direction === "credit" ? e.amountMinor : -e.amountMinor;
    vendorAccruedMinor.set(e.order.vendorId, (vendorAccruedMinor.get(e.order.vendorId) ?? 0) + delta);
  }
  const paidVendorPayouts = await prisma.payout.groupBy({
    by: ["payeeId"],
    where: { payeeType: "vendor", status: "paid" },
    _sum: { amountMinor: true },
  });
  if (paidVendorPayouts.length > 0) {
    const vendors = await prisma.vendorProfile.findMany({
      where: { id: { in: paidVendorPayouts.map((p) => p.payeeId) } },
      select: { id: true, businessName: true },
    });
    const nameById = new Map(vendors.map((v) => [v.id, v.businessName]));
    for (const p of paidVendorPayouts) {
      const paidMinor = p._sum.amountMinor ?? 0;
      const accruedMinor = vendorAccruedMinor.get(p.payeeId) ?? 0;
      if (paidMinor > accruedMinor) {
        discrepancies.push({
          type: "vendor_overpaid",
          message: `${nameById.get(p.payeeId) ?? p.payeeId} has been paid more than the ledger ever credited them.`,
          payeeId: p.payeeId,
          payeeName: nameById.get(p.payeeId),
          details: { accruedMinor, paidMinor, overpaidMinor: paidMinor - accruedMinor },
        });
      }
    }
  }

  // ── Per rider: cashBalanceMinor should equal cash collected minus cash remitted. ──
  const riderCashEntries = await prisma.ledgerEntry.findMany({
    where: { account: "rider_cash_float" },
    select: { direction: true, amountMinor: true, order: { select: { riderId: true } } },
  });
  const riderCollectedMinor = new Map<string, number>();
  for (const e of riderCashEntries) {
    if (!e.order.riderId) continue; // shouldn't happen — rider_cash_float is only posted once a rider has confirmed a delivery — guarded rather than assumed
    const delta = e.direction === "debit" ? e.amountMinor : -e.amountMinor;
    riderCollectedMinor.set(e.order.riderId, (riderCollectedMinor.get(e.order.riderId) ?? 0) + delta);
  }
  if (riderCollectedMinor.size > 0) {
    const [riders, remittanceSums] = await Promise.all([
      prisma.riderProfile.findMany({
        where: { id: { in: [...riderCollectedMinor.keys()] } },
        select: { id: true, fullName: true, cashBalanceMinor: true },
      }),
      prisma.riderCashRemittance.groupBy({ by: ["riderId"], _sum: { amountMinor: true } }),
    ]);
    const remittedByRider = new Map(remittanceSums.map((r) => [r.riderId, r._sum.amountMinor ?? 0]));
    for (const rider of riders) {
      const collectedMinor = riderCollectedMinor.get(rider.id) ?? 0;
      const remittedMinor = remittedByRider.get(rider.id) ?? 0;
      const expectedBalanceMinor = collectedMinor - remittedMinor;
      if (expectedBalanceMinor !== rider.cashBalanceMinor) {
        discrepancies.push({
          type: "rider_cash_mismatch",
          message: `${rider.fullName}'s cash balance doesn't match cash collected minus cash remitted.`,
          payeeId: rider.id,
          payeeName: rider.fullName,
          details: {
            totalCollectedMinor: collectedMinor,
            totalRemittedMinor: remittedMinor,
            expectedBalanceMinor,
            actualBalanceMinor: rider.cashBalanceMinor,
            differenceMinor: rider.cashBalanceMinor - expectedBalanceMinor,
          },
        });
      }
    }
  }

  return discrepancies;
}
