import { z } from "zod";
import { ORDER_STATUSES, FULFILMENT_TYPES, DISPUTE_RESOLUTIONS, DISPUTE_STATUSES } from "./enums.js";
import type { PayoutStatus, DisputeStatus, DisputeResolution, VendorStatus, RiderStatus } from "./enums.js";
import type { OrderSummaryDto } from "./order.js";
import type { CategoryDto } from "./catalog.js";

// US-A-01 — an "application" isn't its own database entity, it's a pending
// VendorProfile or RiderProfile; `type` disambiguates the two id spaces
// (both plain uuids) rather than guessing which table an id belongs to.
export const applicationTypeSchema = z.enum(["vendor", "rider"]);
export type ApplicationType = z.infer<typeof applicationTypeSchema>;

// US-A-01 acceptance criteria: "Approval or rejection is one action, with
// a mandatory reason on rejection" — approve takes no body at all.
export const applicationRejectSchema = z.object({
  reason: z.string().min(1).max(500),
});
export type ApplicationRejectInput = z.infer<typeof applicationRejectSchema>;

// ── Response shapes ─────────────────────────────────────────────────────
//
// Hand-written, not re-exported from Prisma Client (index.ts's note on
// why entity shapes aren't duplicated here doesn't apply as-is: a Prisma
// row and its JSON-over-HTTP wire shape genuinely differ — every Date
// becomes a string once it round-trips through `JSON.stringify`, and
// Prisma types aren't meant for a browser bundle anyway). This is
// specifically the wire contract GET /admin/applications actually
// returns, only the fields the vetting queue UI needs.
export interface PendingVendorApplication {
  type: "vendor";
  id: string;
  businessName: string;
  category: { id: string; name: string };
  description: string | null;
  pickupLandmark: string;
  pickupPhone: string;
  createdAt: string;
}

export interface PendingRiderApplication {
  type: "rider";
  id: string;
  fullName: string;
  vehicleType: string;
  idDocumentUrl: string | null;
  createdAt: string;
}

export type PendingApplication = PendingVendorApplication | PendingRiderApplication;

// ── Payouts (vendor-requested, admin-approved) ──────────────────────────

export const payoutRequestSchema = z.object({
  amountMinor: z.number().int().positive().optional(), // omitted = full available balance
});
export type PayoutRequestInput = z.infer<typeof payoutRequestSchema>;

// Same shape as applicationRejectSchema — mandatory reason on rejection.
export const payoutRejectSchema = z.object({
  reason: z.string().min(1).max(500),
});
export type PayoutRejectInput = z.infer<typeof payoutRejectSchema>;

export interface VendorBalanceDto {
  vendorId: string;
  accruedMinor: number; // lifetime vendor_payable ledger credits, net of debits
  reservedOrPaidMinor: number; // sum of requested/scheduled/paid Payout rows
  availableToWithdrawMinor: number;
}

export interface PayoutDto {
  id: string;
  payeeType: "vendor" | "rider";
  payeeId: string;
  amountMinor: number;
  status: PayoutStatus;
  reference: string | null;
  failureReason: string | null;
  rejectionReason: string | null;
  processedAt: string | null;
  createdAt: string;
}

// GET /admin/payouts/requests — the approval queue, enriched with enough
// vendor context to review without a second round trip.
export interface PendingPayoutRequest extends PayoutDto {
  vendor: { id: string; businessName: string };
}

// ── Order oversight (US-A-03) ───────────────────────────────────────────

// Query-string params, all optional — an empty filter is "everything,
// newest first". Dates are ISO strings (URL-safe), parsed server-side.
export const adminOrderFilterSchema = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  vendorId: z.string().uuid().optional(),
  riderId: z.string().uuid().optional(),
  fulfilmentType: z.enum(FULFILMENT_TYPES).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type AdminOrderFilterInput = z.infer<typeof adminOrderFilterSchema>;

// Same mandatory-reason shape as applicationRejectSchema/payoutRejectSchema
// — every US-A-03 intervention records why (its own acceptance criterion).
export const adminOrderActionSchema = z.object({
  reason: z.string().min(1).max(500),
});
export type AdminOrderActionInput = z.infer<typeof adminOrderActionSchema>;

// GET /admin/orders — OrderSummaryDto (order.ts) plus just enough vendor/
// rider context to scan the list without opening each row.
export interface AdminOrderSummaryDto extends OrderSummaryDto {
  vendor: { businessName: string };
  rider: { fullName: string } | null;
}

// ── Disputes (US-A-04) ───────────────────────────────────────────────────

export const adminDisputeFilterSchema = z.object({
  status: z.enum(DISPUTE_STATUSES).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type AdminDisputeFilterInput = z.infer<typeof adminDisputeFilterSchema>;

// api-contracts.md: `{ resolution, amount_minor?, reason }` — amountMinor
// is only meaningful (and required) for partial_refund; full_refund and
// rejected act on the whole order/nothing respectively.
export const disputeResolveSchema = z
  .object({
    resolution: z.enum(DISPUTE_RESOLUTIONS),
    amountMinor: z.number().int().positive().optional(),
    reason: z.string().min(1).max(500),
  })
  .refine((v) => v.resolution !== "partial_refund" || v.amountMinor !== undefined, {
    message: "amountMinor is required when resolution is partial_refund",
    path: ["amountMinor"],
  });
export type DisputeResolveInput = z.infer<typeof disputeResolveSchema>;

export interface AdminDisputeDto {
  id: string;
  orderId: string;
  customerId: string | null;
  reason: string;
  evidence: string[];
  status: DisputeStatus;
  resolution: DisputeResolution | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
  order: {
    id: string;
    vendorId: string;
    vendor: { businessName: string };
    status: (typeof ORDER_STATUSES)[number];
    totalMinor: number;
    contactPhone: string;
  };
}

// ── Suspend an actor (US-A-06) ──────────────────────────────────────────

// Same mandatory-reason shape as adminOrderActionSchema — every
// suspension/unsuspension is written to the audit log with why.
export const adminActorActionSchema = z.object({
  reason: z.string().min(1).max(500),
});
export type AdminActorActionInput = z.infer<typeof adminActorActionSchema>;

export interface AdminVendorDto {
  id: string;
  businessName: string;
  category: { id: string; name: string };
  status: VendorStatus;
  isOpen: boolean;
  createdAt: string;
}

export interface AdminRiderDto {
  id: string;
  fullName: string;
  vehicleType: string;
  status: RiderStatus;
  onDuty: boolean;
  cashBalanceMinor: number; // US-R-08 — cash this rider still owes the platform
  createdAt: string;
}

// ── Rider cash remittance (US-R-08) ─────────────────────────────────────

// "A remittance is recorded by admin and immediately reduces the balance."
// Amount is required and positive; the service additionally refuses one
// larger than the rider's current balance (a typo'd extra zero would
// otherwise silently drive it negative).
export const recordRemittanceSchema = z.object({
  amountMinor: z.number().int().positive(),
  note: z.string().max(300).optional(),
});
export type RecordRemittanceInput = z.infer<typeof recordRemittanceSchema>;

export interface AdminRemittanceDto {
  id: string;
  riderId: string;
  amountMinor: number;
  recordedBy: string;
  note: string | null;
  createdAt: string;
}

export interface RecordRemittanceResult {
  rider: AdminRiderDto; // with the already-reduced balance
  remittance: AdminRemittanceDto;
}

// A suspension response includes every non-terminal order this actor is
// still on, so an operator can see what's in flight before deciding what
// to do about it (US-A-06's "orders already in flight are listed" —
// deliberately listed, not auto-cancelled).
export interface SuspendVendorResult {
  vendor: AdminVendorDto;
  inFlightOrders: AdminOrderSummaryDto[];
}

export interface SuspendRiderResult {
  rider: AdminRiderDto;
  inFlightOrders: AdminOrderSummaryDto[];
}

// ── Config writes (US-A-02) ─────────────────────────────────────────────

// Every field PATCH /admin/config accepts, each optional — PATCH
// semantics, only the supplied keys get a new versioned Config row
// (admin/config.ts never UPDATEs one, matching prisma/APPEND_ONLY.sql's
// revoked grant). Category CRUD is separate (POST/PATCH /admin/categories,
// catalog.js's categoryCreateSchema/categoryUpdateSchema) — a real table,
// not a Config key.
export const configUpdateSchema = z
  .object({
    commissionRatePickup: z.number().min(0).max(100).optional(), // percent, brief §3.2a
    commissionRateDelivery: z.number().min(0).max(100).optional(),
    vendorAcceptWindowMinutes: z.number().int().positive().optional(),
    flatDeliveryFeeMinor: z.number().int().nonnegative().optional(),
    foundingVendorProgramActive: z.boolean().optional(),
    foundingVendorProgramWaiverMonths: z.number().int().positive().optional(),
    riderCashFloatLimitMinor: z.number().int().positive().optional(), // US-R-08
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "At least one field is required" });
export type ConfigUpdateInput = z.infer<typeof configUpdateSchema>;

// GET /admin/config — every admin-configurable value, live, plus every
// category (active or not, unlike catalog.js's public listCategories
// which only returns isActive ones).
export interface AdminConfigDto {
  commissionRatePickup: number;
  commissionRateDelivery: number;
  vendorAcceptWindowMinutes: number;
  flatDeliveryFeeMinor: number;
  foundingVendorProgramActive: boolean;
  foundingVendorProgramWaiverMonths: number;
  riderCashFloatLimitMinor: number; // US-R-08 — falls back to a default until an admin sets one
  categories: CategoryDto[];
}

// ── Platform metrics (US-A-07) ──────────────────────────────────────────

// A real calendar day (2026-09-24), not just something shaped like one.
const calendarDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "Not a real calendar date");

// Both bounds are optional and inclusive. Omitted → the last 30 days ending
// today, in Africa/Lagos (the only timezone the platform operates in). The
// service — not this schema — rejects a reversed or over-long range, since it
// needs the resolved defaults to judge that.
export const adminMetricsQuerySchema = z.object({
  from: calendarDaySchema.optional(),
  to: calendarDaySchema.optional(),
});
export type AdminMetricsQuery = z.infer<typeof adminMetricsQuerySchema>;

// Longest range the endpoint will aggregate. The per-day series is built in
// application code from one row per order, so an unbounded range would mean
// an unbounded read.
export const MAX_METRICS_RANGE_DAYS = 366;

// GET /admin/metrics. Every figure is scoped to orders *placed* in the range
// (cohorted by placement day, Africa/Lagos) so the numbers always agree with
// each other — except the three "right now" ones flagged below. Definitions
// live next to the code that computes them: admin/metrics.ts.
export interface AdminMetricsDto {
  range: { from: string; to: string }; // inclusive calendar days
  timezone: "Africa/Lagos";
  orders: {
    placedCount: number; // payment confirmed or COD accepted — abandoned PENDING_PAYMENT checkouts excluded
    fulfilledCount: number; // DELIVERED or COMPLETED
    inFlightCount: number; // still moving — kept out of the completion rate
    failedCount: number; // DELIVERY_FAILED
    cancelledOrRefundedCount: number;
    disputedCount: number; // placed in range and has a dispute
  };
  grossMinor: number; // placed orders' totals, excluding CANCELLED/REFUNDED
  completionRate: number | null; // 0–1; fulfilled ÷ (fulfilled + cancelled/refunded + failed). null with nothing decided yet
  averageDeliveryMinutes: number | null; // PAID → DELIVERED, delivery orders only, scheduled ones excluded
  deliveriesMeasured: number; // how many orders that average is over
  openDisputes: number; // right now, not range-scoped — a queue, not a rate
  vendors: { approved: number; active: number }; // approved is right now; active = had a placed order in range
  riders: { approved: number; active: number }; // approved is right now; active = carried a placed order in range
  perDay: Array<{ date: string; orders: number; grossMinor: number }>; // every day in range, zero-filled
}

// ── Audit log (US-A-08) ─────────────────────────────────────────────────

export const auditLogFilterSchema = z.object({
  actorId: z.string().uuid().optional(),
  targetType: z.string().optional(),
  targetId: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type AuditLogFilterInput = z.infer<typeof auditLogFilterSchema>;

export interface AuditLogEntryDto {
  id: string;
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  reason: string | null;
  createdAt: string;
}
