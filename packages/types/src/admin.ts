import { z } from "zod";

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
