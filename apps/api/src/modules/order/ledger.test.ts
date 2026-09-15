import { describe, it, expect } from "vitest";
import { escrowHoldEntries, computeEscrowSplit, escrowReleaseEntries, refundEntries, codCollectionEntries } from "./ledger.js";

function sumByDirection(rows: { direction: string; amountMinor: number }[]) {
  return {
    debits: rows.filter((r) => r.direction === "debit").reduce((s, r) => s + r.amountMinor, 0),
    credits: rows.filter((r) => r.direction === "credit").reduce((s, r) => s + r.amountMinor, 0),
  };
}

describe("ledger — data-model.md §6 invariant: every entry set balances", () => {
  it("escrowHoldEntries: debits platform_clearing, credits customer_escrow, for the full amount", () => {
    const rows = escrowHoldEntries("order_1", 500000);
    const { debits, credits } = sumByDirection(rows);

    expect(debits).toBe(500000);
    expect(credits).toBe(500000);
    expect(rows.find((r) => r.account === "platform_clearing")?.direction).toBe("debit");
    expect(rows.find((r) => r.account === "customer_escrow")?.direction).toBe("credit");
  });

  it("computeEscrowSplit: commission applies to goods only, never to the delivery fee", () => {
    // ₦5,000 total, ₦500 delivery fee, 10% commission (brief §3.2a delivery rate)
    const split = computeEscrowSplit(500000, 50000, 10);

    // Commission is 10% of (500000 - 50000) = 45000, not 10% of 500000.
    expect(split.commissionMinor).toBe(45000);
    expect(split.deliveryFeeMinor).toBe(50000);
    expect(split.vendorNetMinor).toBe(500000 - 50000 - 45000); // 405000
  });

  it("computeEscrowSplit: pickup has no delivery fee, 5% commission on the full amount", () => {
    const split = computeEscrowSplit(500000, 0, 5);

    expect(split.deliveryFeeMinor).toBe(0);
    expect(split.commissionMinor).toBe(25000); // 5% of 500000
    expect(split.vendorNetMinor).toBe(475000);
  });

  it("computeEscrowSplit: rounds commission rather than leaving fractional kobo", () => {
    // 333 kobo goods at 10% = 33.3 -> must round to an integer, never a float
    const split = computeEscrowSplit(333, 0, 10);
    expect(Number.isInteger(split.commissionMinor)).toBe(true);
  });

  it("escrowReleaseEntries: debits escrow for the full total, credits exactly the three destinations, and it all balances", () => {
    const split = computeEscrowSplit(500000, 50000, 10);
    const rows = escrowReleaseEntries("order_1", 500000, split);
    const { debits, credits } = sumByDirection(rows);

    expect(debits).toBe(500000);
    expect(credits).toBe(500000);
    expect(rows.map((r) => r.account).sort()).toEqual(
      ["customer_escrow", "platform_commission", "rider_payable", "vendor_payable"].sort(),
    );
  });

  it("escrowReleaseEntries: omits rider_payable entirely for a pickup order (zero delivery fee)", () => {
    const split = computeEscrowSplit(500000, 0, 5);
    const rows = escrowReleaseEntries("order_1", 500000, split);

    expect(rows.find((r) => r.account === "rider_payable")).toBeUndefined();
    const { debits, credits } = sumByDirection(rows);
    expect(debits).toBe(credits);
  });

  it("codCollectionEntries: debits rider_cash_float instead of platform_clearing, credits customer_escrow the same way card/transfer does", () => {
    const rows = codCollectionEntries("order_1", 500000);
    const { debits, credits } = sumByDirection(rows);

    expect(debits).toBe(500000);
    expect(credits).toBe(500000);
    expect(rows.find((r) => r.account === "rider_cash_float")?.direction).toBe("debit");
    expect(rows.find((r) => r.account === "customer_escrow")?.direction).toBe("credit");
  });

  it("refundEntries: reverses the hold exactly, balances", () => {
    const rows = refundEntries("order_1", 500000);
    const { debits, credits } = sumByDirection(rows);

    expect(debits).toBe(500000);
    expect(credits).toBe(500000);
    // Exact reverse of escrowHoldEntries's directions.
    expect(rows.find((r) => r.account === "customer_escrow")?.direction).toBe("debit");
    expect(rows.find((r) => r.account === "platform_clearing")?.direction).toBe("credit");
  });
});
