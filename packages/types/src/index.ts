/**
 * @closebuy/types — shared, framework-agnostic types and Zod schemas used by
 * both the API (apps/api) and every client app.
 *
 * Scope note: this package currently covers Auth (M0) plus the enums shared
 * across the whole domain (data-model.md), which cost nothing to define now
 * since they're already fully settled in stage 02. The bulk of the entity
 * shapes (Product, Order, Payment, LedgerEntry, ...) are intentionally
 * *not* hand-duplicated here — once apps/api's Prisma schema exists, Prisma
 * Client is the source of truth for those shapes, and this package will
 * re-export the ones API responses actually expose, rather than maintaining
 * a second, driftable copy. Filling that in is M1 scope, not M0.
 */
export * from "./money.js";
export * from "./enums.js";
export * from "./auth.js";
export * from "./user.js";
export * from "./catalog.js";
export * from "./order.js";
export * from "./rider.js";
export * from "./admin.js";
export * from "./notifications.js";
