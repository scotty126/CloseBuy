import type { PrismaClient } from "@prisma/client";

/**
 * Config is versioned and admin-managed (US-A-02, data-model.md §5) — this
 * just reads the currently-effective value for a key. There's no admin UI
 * to write these yet (that's Admin, unbuilt), so prisma/seed.ts inserts
 * version 1 of each key this module needs; a real admin write later is
 * just a new row with an incremented version, never an edit.
 */
export async function getConfigValue<T>(prisma: PrismaClient, key: string): Promise<T> {
  const config = await prisma.config.findFirst({
    where: { key, effectiveAt: { lte: new Date() } },
    orderBy: { version: "desc" },
  });
  if (!config) {
    throw new Error(`Config key "${key}" has no effective value — has prisma/seed.ts been run?`);
  }
  return config.value as T;
}

// Typed accessors for the specific keys Order/Payments actually need —
// callers shouldn't have to know the raw key strings or JSON shapes.
export const ConfigKeys = {
  async commissionRatePickup(prisma: PrismaClient): Promise<number> {
    return getConfigValue<number>(prisma, "commission_rate.pickup");
  },
  async commissionRateDelivery(prisma: PrismaClient): Promise<number> {
    return getConfigValue<number>(prisma, "commission_rate.delivery");
  },
  /** Minutes a vendor has to accept a PAID order before it auto-rejects (US-V-05). */
  async vendorAcceptWindowMinutes(prisma: PrismaClient): Promise<number> {
    return getConfigValue<number>(prisma, "vendor_accept_window_minutes");
  },
  /** Hours after DELIVERED before escrow auto-releases if no dispute is opened (US-C-11, brief §4). */
  async escrowReleaseWindowHours(prisma: PrismaClient): Promise<number> {
    return getConfigValue<number>(prisma, "escrow_release_window_hours");
  },
  /**
   * Flat delivery fee, minor units — a real fee schedule (distance/weight-
   * based, per US-A-02 "delivery fee rules") isn't built yet. Flagged
   * simplification, not a silent guess: every order pays the same fee
   * regardless of distance until that exists.
   */
  async flatDeliveryFeeMinor(prisma: PrismaClient): Promise<number> {
    return getConfigValue<number>(prisma, "flat_delivery_fee_minor");
  },
  /** Whether a newly-approved vendor currently starts their commission-free window (US-A-01, brief §3.2a). */
  async foundingVendorProgramActive(prisma: PrismaClient): Promise<boolean> {
    return getConfigValue<boolean>(prisma, "founding_vendor_program_active");
  },
  /** Length of that window in months — configurable (US-A-02), default 3 (brief §3.2a). */
  async foundingVendorProgramWaiverMonths(prisma: PrismaClient): Promise<number> {
    return getConfigValue<number>(prisma, "founding_vendor_program_waiver_months");
  },
  /**
   * US-R-08 — once a rider's uncleared cash balance exceeds this, cash-on-
   * delivery jobs stop being offered to (or claimable by) them until an
   * admin records a remittance. Unlike every key above this one falls back
   * to a default when no row exists, instead of throwing: it was added
   * after the seed ran, and a rider-facing endpoint 500ing for every rider
   * until someone remembers to seed production would be a far worse failure
   * than a placeholder limit. Still admin-editable (US-A-02) like the rest.
   */
  async riderCashFloatLimitMinor(prisma: PrismaClient): Promise<number> {
    const row = await prisma.config.findFirst({
      where: { key: RIDER_CASH_FLOAT_LIMIT_KEY, effectiveAt: { lte: new Date() } },
      orderBy: { version: "desc" },
    });
    return row ? (row.value as number) : DEFAULT_RIDER_CASH_FLOAT_LIMIT_MINOR;
  },
};

export const RIDER_CASH_FLOAT_LIMIT_KEY = "rider_cash_float_limit_minor";
/** ₦100,000 — a placeholder, not a researched figure (same status as flat_delivery_fee_minor above): roughly ten typical grocery orders' worth of cash. */
export const DEFAULT_RIDER_CASH_FLOAT_LIMIT_MINOR = 10_000_000;
