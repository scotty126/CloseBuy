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

/** Formats minor units as a Naira display string, e.g. minor(150000) -> "₦1,500.00" */
export function formatNaira(value: MinorUnits): string {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
  }).format(value / 100);
}
