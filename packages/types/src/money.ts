/**
 * Money is always an integer in the minor currency unit (kobo), never a
 * float. This is a hard invariant from data-model.md §6 — enforced here
 * with a branded type so a raw `number` can't be passed where a money
 * value is expected without going through `minor()` first.
 */
export type MinorUnits = number & { readonly __brand: "MinorUnits" };

export function minor(value: number): MinorUnits {
  if (!Number.isInteger(value)) {
    throw new TypeError(`Money must be an integer minor-unit value, got ${value}`);
  }
  return value as MinorUnits;
}

export function addMinor(...values: MinorUnits[]): MinorUnits {
  return minor(values.reduce((sum, v) => sum + v, 0));
}

/**
 * Formats minor units as a Naira display string. Whole-naira amounts drop the
 * ".00" (minor(810000) -> "₦8,100"), matching the redesign; anything with kobo
 * keeps both decimals (minor(150050) -> "₦1,500.50") so no value is ever
 * rounded away. Pass { exact: true } where columns of money must line up
 * (admin ledgers, reconciliation) — always two decimals.
 */
export function formatNaira(value: MinorUnits, opts: { exact?: boolean } = {}): string {
  const whole = value % 100 === 0;
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: whole && !opts.exact ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value / 100);
}
