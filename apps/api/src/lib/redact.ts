/**
 * Strips fields from an object before it leaves the service layer.
 * `Order.collectionCode`/`deliveryCode` are meant to be told to the right
 * party in person (vendor tells rider, then customer tells rider) — never
 * read back from a screen the wrong party controls, or the code stops
 * verifying anything. Applied at response time, not at the query level,
 * so the query itself can stay a plain `include` and every call site
 * doesn't have to hand-maintain its own `select` shape.
 */
export function omitFields<T extends Record<string, unknown>, K extends keyof T>(obj: T, keys: K[]): Omit<T, K> {
  const clone = { ...obj } as T;
  for (const key of keys) delete clone[key];
  return clone;
}
