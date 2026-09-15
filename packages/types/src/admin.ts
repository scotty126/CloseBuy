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
