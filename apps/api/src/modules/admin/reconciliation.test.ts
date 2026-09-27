import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createAdminReconciliationService } from "./reconciliation.js";

/**
 * In-memory fake Prisma covering exactly what reconciliation.ts touches:
 * `ledgerEntry` (groupBy/aggregate/findMany with the order relation
 * resolved), `payout` (groupBy), `vendorProfile`/`riderProfile` (findMany),
 * `riderCashRemittance` (aggregate/groupBy). `groupBy` and `aggregate` are
 * small generic implementations (group by 1-2 fields, sum a numeric
 * column, optional count) rather than one-off stubs per call site, since
 * this module calls them with several different shapes.
 */
function createFakePrisma() {
  const ledgerEntries: Array<{ orderId: string; account: string; direction: "debit" | "credit"; amountMinor: number }> = [];
  const orders = new Map<string, { vendorId: string; riderId: string | null }>();
  const payouts: Array<{ payeeType: string; payeeId: string; status: string; amountMinor: number }> = [];
  const vendors = new Map<string, { id: string; businessName: string }>();
  const riders = new Map<string, { id: string; fullName: string; cashBalanceMinor: number }>();
  const remittances: Array<{ riderId: string; amountMinor: number }> = [];

  function sumFieldOf(_sum: Record<string, boolean>): string {
    return Object.keys(_sum)[0]!; // every call site here passes exactly one field to sum — a test-fake simplification, not a general-purpose Prisma shim
  }

  function groupBy<T extends Record<string, any>>(rows: T[], by: string[], where: ((r: T) => boolean) | undefined, sumField: string) {
    where ??= () => true;
    const groups = new Map<string, { key: Record<string, any>; sum: number; count: number }>();
    for (const row of rows) {
      if (!where(row)) continue;
      const key = Object.fromEntries(by.map((k) => [k, row[k]]));
      const keyStr = JSON.stringify(key);
      const g = groups.get(keyStr) ?? { key, sum: 0, count: 0 };
      g.sum += row[sumField];
      g.count += 1;
      groups.set(keyStr, g);
    }
    return [...groups.values()].map((g) => ({ ...g.key, _sum: { [sumField]: g.sum }, _count: g.count }));
  }

  const db: any = {
    ledgerEntry: {
      groupBy: async ({ by, where, _sum }: any) => {
        const field = sumFieldOf(_sum);
        const filter = where ? (r: any) => Object.entries(where).every(([k, v]) => r[k] === v) : undefined;
        return groupBy(ledgerEntries, by, filter, field);
      },
      aggregate: async ({ where, _sum }: any) => {
        const field = sumFieldOf(_sum);
        const filtered = ledgerEntries.filter((r) => !where || Object.entries(where).every(([k, v]) => (r as any)[k] === v));
        return { _sum: { [field]: filtered.reduce((s, r) => s + (r as any)[field], 0) } };
      },
      findMany: async ({ where }: any) => {
        const filtered = ledgerEntries.filter((r) => !where || Object.entries(where).every(([k, v]) => (r as any)[k] === v));
        return filtered.map((r) => ({ direction: r.direction, amountMinor: r.amountMinor, order: orders.get(r.orderId) }));
      },
    },
    payout: {
      groupBy: async ({ by, where, _sum }: any) => {
        const field = sumFieldOf(_sum);
        const filter = where ? (r: any) => Object.entries(where).every(([k, v]) => r[k] === v) : undefined;
        return groupBy(payouts, by, filter, field);
      },
    },
    vendorProfile: {
      findMany: async ({ where }: any) => [...vendors.values()].filter((v) => where.id.in.includes(v.id)),
    },
    riderProfile: {
      findMany: async ({ where }: any) => [...riders.values()].filter((r) => where.id.in.includes(r.id)),
    },
    riderCashRemittance: {
      aggregate: async ({ _sum }: any) => ({ _sum: { amountMinor: remittances.reduce((s, r) => s + r.amountMinor, 0) } }),
      groupBy: async ({ by, _sum }: any) => groupBy(remittances, by, undefined, sumFieldOf(_sum)),
    },
    __state: { ledgerEntries, orders, payouts, vendors, riders, remittances },
  };
  return db as PrismaClient & { __state: typeof db.__state };
}

function ledger(prisma: ReturnType<typeof createFakePrisma>, orderId: string, account: string, direction: "debit" | "credit", amountMinor: number) {
  prisma.__state.ledgerEntries.push({ orderId, account, direction, amountMinor });
}

function order(prisma: ReturnType<typeof createFakePrisma>, orderId: string, vendorId: string, riderId: string | null = null) {
  prisma.__state.orders.set(orderId, { vendorId, riderId });
}

function service(prisma: ReturnType<typeof createFakePrisma>, monnifyConfigured = false) {
  return createAdminReconciliationService({ prisma, monnifyConfigured });
}

describe("admin reconciliation (US-A-05's other half)", () => {
  it("totals each ledger account's credits, debits and net", async () => {
    const prisma = createFakePrisma();
    order(prisma, "o1", "v1");
    ledger(prisma, "o1", "platform_clearing", "debit", 100000);
    ledger(prisma, "o1", "customer_escrow", "credit", 100000);

    const report = await service(prisma).getReport();
    const clearing = report.ledgerByAccount.find((a) => a.account === "platform_clearing")!;
    expect(clearing).toMatchObject({ debitMinor: 100000, creditMinor: 0, netMinor: -100000 });
    const escrow = report.ledgerByAccount.find((a) => a.account === "customer_escrow")!;
    expect(escrow).toMatchObject({ debitMinor: 0, creditMinor: 100000, netMinor: 100000 });
  });

  it("lists every known ledger account even with zero activity, never omitting one", async () => {
    const report = await service(createFakePrisma()).getReport();
    expect(report.ledgerByAccount.map((a) => a.account).sort()).toEqual(
      ["customer_escrow", "platform_clearing", "platform_commission", "rider_cash_float", "rider_payable", "vendor_payable"].sort(),
    );
    expect(report.ledgerByAccount.every((a) => a.netMinor === 0)).toBe(true);
  });

  it("a balanced ledger (the normal, healthy case) raises no discrepancy", async () => {
    const prisma = createFakePrisma();
    order(prisma, "o1", "v1");
    ledger(prisma, "o1", "platform_clearing", "debit", 500000);
    ledger(prisma, "o1", "customer_escrow", "credit", 500000);

    const report = await service(prisma).getReport();
    expect(report.discrepancies).toEqual([]);
  });

  it("flags a platform-wide debit/credit mismatch — should be structurally impossible, so a real red flag", async () => {
    const prisma = createFakePrisma();
    order(prisma, "o1", "v1");
    ledger(prisma, "o1", "platform_clearing", "debit", 500000);
    ledger(prisma, "o1", "customer_escrow", "credit", 400000); // deliberately unbalanced — real code never does this (assertBalanced), a fake row standing in for "something bypassed it"

    const report = await service(prisma).getReport();
    expect(report.discrepancies).toContainEqual(
      expect.objectContaining({ type: "unbalanced_ledger", details: { totalDebitMinor: 500000, totalCreditMinor: 400000, differenceMinor: 100000 } }),
    );
  });

  it("flags a vendor paid more than the ledger ever credited them", async () => {
    const prisma = createFakePrisma();
    prisma.__state.vendors.set("v1", { id: "v1", businessName: "Mama Put Kitchen" });
    order(prisma, "o1", "v1");
    ledger(prisma, "o1", "vendor_payable", "credit", 300000); // accrued ₦3,000
    prisma.__state.payouts.push({ payeeType: "vendor", payeeId: "v1", status: "paid", amountMinor: 500000 }); // paid ₦5,000 — too much

    const report = await service(prisma).getReport();
    expect(report.discrepancies).toContainEqual(
      expect.objectContaining({
        type: "vendor_overpaid",
        payeeId: "v1",
        payeeName: "Mama Put Kitchen",
        details: { accruedMinor: 300000, paidMinor: 500000, overpaidMinor: 200000 },
      }),
    );
  });

  it("does not flag a vendor paid exactly, or less than, what they accrued", async () => {
    const prisma = createFakePrisma();
    prisma.__state.vendors.set("v1", { id: "v1", businessName: "Mama Put Kitchen" });
    order(prisma, "o1", "v1");
    ledger(prisma, "o1", "vendor_payable", "credit", 300000);
    prisma.__state.payouts.push({ payeeType: "vendor", payeeId: "v1", status: "paid", amountMinor: 300000 });

    const report = await service(prisma).getReport();
    expect(report.discrepancies.filter((d) => d.type === "vendor_overpaid")).toEqual([]);
  });

  it("a requested/scheduled (not yet paid) payout never counts toward overpayment", async () => {
    const prisma = createFakePrisma();
    prisma.__state.vendors.set("v1", { id: "v1", businessName: "Mama Put Kitchen" });
    order(prisma, "o1", "v1");
    ledger(prisma, "o1", "vendor_payable", "credit", 100000);
    prisma.__state.payouts.push({ payeeType: "vendor", payeeId: "v1", status: "requested", amountMinor: 900000 });

    const report = await service(prisma).getReport();
    expect(report.discrepancies.filter((d) => d.type === "vendor_overpaid")).toEqual([]);
  });

  it("flags a rider whose cashBalanceMinor doesn't match collected minus remitted", async () => {
    const prisma = createFakePrisma();
    prisma.__state.riders.set("r1", { id: "r1", fullName: "Chukwuemeka Adeyemi-Okafor", cashBalanceMinor: 999999 }); // should be 810000 - 500000 = 310000
    order(prisma, "o1", "v1", "r1");
    ledger(prisma, "o1", "rider_cash_float", "debit", 810000);
    ledger(prisma, "o1", "customer_escrow", "credit", 810000); // codCollectionEntries' real other half — keeps the fixture's ledger balanced, so only the rider check this test targets fires
    prisma.__state.remittances.push({ riderId: "r1", amountMinor: 500000 });

    const report = await service(prisma).getReport();
    expect(report.discrepancies).toContainEqual(
      expect.objectContaining({
        type: "rider_cash_mismatch",
        payeeId: "r1",
        details: expect.objectContaining({ totalCollectedMinor: 810000, totalRemittedMinor: 500000, expectedBalanceMinor: 310000, actualBalanceMinor: 999999 }),
      }),
    );
  });

  it("a rider whose balance correctly reflects collected minus remitted is not flagged", async () => {
    const prisma = createFakePrisma();
    prisma.__state.riders.set("r1", { id: "r1", fullName: "Bola Ibrahim", cashBalanceMinor: 310000 });
    order(prisma, "o1", "v1", "r1");
    ledger(prisma, "o1", "rider_cash_float", "debit", 810000);
    ledger(prisma, "o1", "customer_escrow", "credit", 810000); // codCollectionEntries' real other half
    prisma.__state.remittances.push({ riderId: "r1", amountMinor: 500000 });

    const report = await service(prisma).getReport();
    expect(report.discrepancies).toEqual([]);
  });

  it("a rider with no rider_cash_float activity at all is never checked (nothing to compare)", async () => {
    const prisma = createFakePrisma();
    prisma.__state.riders.set("r1", { id: "r1", fullName: "Idle Rider", cashBalanceMinor: 12345 }); // never delivered anything — this being nonzero would be a different bug, out of this report's scope
    const report = await service(prisma).getReport();
    expect(report.discrepancies).toEqual([]);
  });

  it("totals payouts by status, with both count and amount", async () => {
    const prisma = createFakePrisma();
    prisma.__state.payouts.push(
      { payeeType: "vendor", payeeId: "v1", status: "paid", amountMinor: 100000 },
      { payeeType: "vendor", payeeId: "v2", status: "paid", amountMinor: 200000 },
      { payeeType: "vendor", payeeId: "v3", status: "requested", amountMinor: 50000 },
    );
    const report = await service(prisma).getReport();
    expect(report.payoutTotals.paid).toEqual({ count: 2, amountMinor: 300000 });
    expect(report.payoutTotals.requested).toEqual({ count: 1, amountMinor: 50000 });
    expect(report.payoutTotals.rejected).toBeUndefined(); // never invented as a zero row — absent means none happened
  });

  it("totals rider cash remittances lifetime, across every rider", async () => {
    const prisma = createFakePrisma();
    prisma.__state.remittances.push({ riderId: "r1", amountMinor: 100000 }, { riderId: "r2", amountMinor: 250000 });
    const report = await service(prisma).getReport();
    expect(report.remittanceTotalMinor).toBe(350000);
  });

  it("gateway settlement is honestly unavailable when Monnify isn't configured, and says so", async () => {
    const report = await service(createFakePrisma(), false).getReport();
    expect(report.gatewaySettlement).toMatchObject({ available: false, configured: false });
    expect(report.gatewaySettlement.reason).toMatch(/not configured|cash on delivery/i);
  });

  it("gateway settlement is still unavailable (but says why differently) once Monnify IS configured", async () => {
    const report = await service(createFakePrisma(), true).getReport();
    expect(report.gatewaySettlement).toMatchObject({ available: false, configured: true });
    expect(report.gatewaySettlement.reason).toMatch(/isn't built yet/i);
  });

  it("stamps a real generatedAt timestamp", async () => {
    const before = Date.now();
    const report = await service(createFakePrisma()).getReport();
    const generatedAt = new Date(report.generatedAt).getTime();
    expect(generatedAt).toBeGreaterThanOrEqual(before);
    expect(generatedAt).toBeLessThanOrEqual(Date.now());
  });
});
