import { z } from "zod";
import { phoneSchema } from "./auth.js";

// ── Vendor ──────────────────────────────────────────────────────────────

// US-V-01 — pickup address is a pin + landmark + phone, never a postal
// string (brief §3.4).
export const vendorApplicationSchema = z.object({
  businessName: z.string().min(2).max(100),
  categoryId: z.string().uuid(),
  description: z.string().max(500).optional(),
  pickupLat: z.number().min(-90).max(90),
  pickupLng: z.number().min(-180).max(180),
  pickupLandmark: z.string().min(3).max(200),
  pickupPhone: phoneSchema,
  bankAccountRef: z.string().optional(),
});
export type VendorApplicationInput = z.infer<typeof vendorApplicationSchema>;

// US-V-02 — a vendor edits their own storefront. All optional: PATCH
// semantics, only supplied fields change.
export const vendorUpdateSchema = z.object({
  businessName: z.string().min(2).max(100).optional(),
  description: z.string().max(500).optional(),
  logoUrl: z.string().url().optional(),
  isOpen: z.boolean().optional(),
  supportsPickup: z.boolean().optional(), // brief §3.1a — independent of isOpen
  openingHours: z.record(z.string(), z.array(z.string()).length(2)).optional(),
});
export type VendorUpdateInput = z.infer<typeof vendorUpdateSchema>;

export const vendorSearchQuerySchema = z.object({
  category: z.string().uuid().optional(),
  q: z.string().min(1).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  fulfilment: z.enum(["delivery", "pickup"]).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type VendorSearchQuery = z.infer<typeof vendorSearchQuerySchema>;

// ── Product ─────────────────────────────────────────────────────────────

// US-V-03 — price is an integer in minor units, never a float, checked
// here at the API boundary as well as in the schema (data-model.md §6).
export const productCreateSchema = z.object({
  categoryId: z.string().uuid(),
  name: z.string().min(2).max(120),
  description: z.string().max(1000).optional(),
  priceMinor: z.number().int().nonnegative(),
  images: z.array(z.string().url()).min(1).max(8),
  stock: z.number().int().nonnegative().default(0),
});
export type ProductCreateInput = z.infer<typeof productCreateSchema>;

export const productUpdateSchema = productCreateSchema.partial().extend({
  isActive: z.boolean().optional(), // deactivate, never hard-delete (US-V-03)
});
export type ProductUpdateInput = z.infer<typeof productUpdateSchema>;

// ── Category (admin-managed, US-A-02) ──────────────────────────────────

export const categoryCreateSchema = z.object({
  name: z.string().min(2).max(60),
  defaultPrepMinutes: z.number().int().positive().default(15),
});
export type CategoryCreateInput = z.infer<typeof categoryCreateSchema>;
