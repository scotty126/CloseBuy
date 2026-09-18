import { z } from "zod";
import type { PayoutStatus } from "./enums.js";

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
