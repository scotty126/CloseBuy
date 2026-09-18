import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { computeVendorBalance } from "./balance.js";

/** Minimal fake — just enough of ledgerEntry.aggregate/payout.aggregate to exercise the join+netting logic, matching every other module's fake-Prisma convention. */
function createFakePrisma() {
  const orders = new Map<string, { vendorId: string }>();
  const ledgerEntries: Array<{ orderId: string; account: string; direction: "debit" | "credit"; amountMinor: number }> = [];
  const payouts: Array<{ payeeType: string; payeeId: string; status: string; amountMinor: number }> = [];

  function sumLedger(account: string, direction: string, vendorId: string) {
    return ledgerEntries
      .filter((e) => e.account === account && e.direction === direction && orders.get(e.orderId)?.vendorId === vendorId)
      .reduce((s, e) => s + e.amountMinor, 0);
  }

  const db = {
    ledgerEntry: {
      aggregate: async ({ where }: any) => ({
        _sum: { amountMinor: sumLedger(where.account, where.direction, where.order.vendorId) },
      }),
    },
    payout: {
      aggregate: async ({ where }: any) => ({
        _sum: {
          amountMinor: payouts
            .filter((p) => p.payeeType === where.payeeType && p.payeeId === where.payeeId && where.status.in.includes(p.status))
            .reduce((s, p) => s + p.amountMinor, 0),
        },
      }),
    },
    __state: { orders, ledgerEntries, payouts },
  };

  return db as unknown as PrismaClient & { __state: typeof db.__state };
}

const VENDOR_A = "vendor_a";
const VENDOR_B = "vendor_b";

function seedOrder(prisma: ReturnType<typeof createFakePrisma>, orderId: string, vendorId: string) {
  prisma.__state.orders.set(orderId, { vendorId });
}

function seedCredit(prisma: ReturnType<typeof createFakePrisma>, orderId: string, amountMinor: number) {
  prisma.__state.ledgerEntries.push({ orderId, account: "vendor_payable", direction: "credit", amountMinor });
}

function seedPayout(prisma: ReturnType<typeof createFakePrisma>, vendorId: string, status: string, amountMinor: number) {
  prisma.__state.payouts.push({ payeeType: "vendor", payeeId: vendorId, status, amountMinor });
}

describe("computeVendorBalance", () => {
  it("is zero for a vendor with no orders and no payouts", async () => {
    const prisma = createFakePrisma();
    const balance = await computeVendorBalance(prisma, VENDOR_A);
    expect(balance).toMatchObject({ accruedMinor: 0, reservedOrPaidMinor: 0, availableToWithdrawMinor: 0 });
  });

  it("sums vendor_payable credits across multiple completed orders for the same vendor", async () => {
    const prisma = createFakePrisma();
    seedOrder(prisma, "order_1", VENDOR_A);
    seedOrder(prisma, "order_2", VENDOR_A);
    seedCredit(prisma, "order_1", 5_000_00);
    seedCredit(prisma, "order_2", 3_000_00);

    const balance = await computeVendorBalance(prisma, VENDOR_A);
    expect(balance.accruedMinor).toBe(8_000_00);
    expect(balance.availableToWithdrawMinor).toBe(8_000_00);
  });

  it("a paid Payout reduces availableToWithdrawMinor", async () => {
    const prisma = createFakePrisma();
    seedOrder(prisma, "order_1", VENDOR_A);
    seedCredit(prisma, "order_1", 5_000_00);
    seedPayout(prisma, VENDOR_A, "paid", 2_000_00);

    const balance = await computeVendorBalance(prisma, VENDOR_A);
    expect(balance.availableToWithdrawMinor).toBe(3_000_00);
  });

  it("a scheduled (in-flight) Payout also reduces availableToWithdrawMinor", async () => {
    const prisma = createFakePrisma();
    seedOrder(prisma, "order_1", VENDOR_A);
    seedCredit(prisma, "order_1", 5_000_00);
    seedPayout(prisma, VENDOR_A, "scheduled", 2_000_00);

    const balance = await computeVendorBalance(prisma, VENDOR_A);
    expect(balance.availableToWithdrawMinor).toBe(3_000_00);
  });

  it("a requested (not yet decided) Payout also reduces availableToWithdrawMinor", async () => {
    const prisma = createFakePrisma();
    seedOrder(prisma, "order_1", VENDOR_A);
    seedCredit(prisma, "order_1", 5_000_00);
    seedPayout(prisma, VENDOR_A, "requested", 2_000_00);

    const balance = await computeVendorBalance(prisma, VENDOR_A);
    expect(balance.availableToWithdrawMinor).toBe(3_000_00);
  });

  it("a failed Payout does not reduce the balance — the money never moved", async () => {
    const prisma = createFakePrisma();
    seedOrder(prisma, "order_1", VENDOR_A);
    seedCredit(prisma, "order_1", 5_000_00);
    seedPayout(prisma, VENDOR_A, "failed", 2_000_00);

    const balance = await computeVendorBalance(prisma, VENDOR_A);
    expect(balance.availableToWithdrawMinor).toBe(5_000_00);
  });

  it("a rejected Payout does not reduce the balance — released back", async () => {
    const prisma = createFakePrisma();
    seedOrder(prisma, "order_1", VENDOR_A);
    seedCredit(prisma, "order_1", 5_000_00);
    seedPayout(prisma, VENDOR_A, "rejected", 2_000_00);

    const balance = await computeVendorBalance(prisma, VENDOR_A);
    expect(balance.availableToWithdrawMinor).toBe(5_000_00);
  });

  it("never mixes one vendor's ledger entries or payouts into another's balance", async () => {
    const prisma = createFakePrisma();
    seedOrder(prisma, "order_1", VENDOR_A);
    seedOrder(prisma, "order_2", VENDOR_B);
    seedCredit(prisma, "order_1", 5_000_00);
    seedCredit(prisma, "order_2", 9_000_00);
    seedPayout(prisma, VENDOR_B, "paid", 1_000_00);

    const balanceA = await computeVendorBalance(prisma, VENDOR_A);
    const balanceB = await computeVendorBalance(prisma, VENDOR_B);
    expect(balanceA.availableToWithdrawMinor).toBe(5_000_00);
    expect(balanceB.availableToWithdrawMinor).toBe(8_000_00);
  });

  it("nets a vendor_payable debit against credits rather than ignoring it", async () => {
    const prisma = createFakePrisma();
    seedOrder(prisma, "order_1", VENDOR_A);
    seedCredit(prisma, "order_1", 5_000_00);
    prisma.__state.ledgerEntries.push({ orderId: "order_1", account: "vendor_payable", direction: "debit", amountMinor: 1_000_00 });

    const balance = await computeVendorBalance(prisma, VENDOR_A);
    expect(balance.accruedMinor).toBe(4_000_00);
  });
});
