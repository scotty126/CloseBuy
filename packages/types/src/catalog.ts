import { z } from "zod";
import { phoneSchema } from "./auth.js";
import type { VendorStatus } from "./enums.js";

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
  // Structured, not a free-form reference — a real transfer (payouts
  // module) needs an account number and bank code as separate fields.
  bankAccountNumber: z.string().length(10).optional(),
  bankCode: z.string().min(1).optional(),
  bankAccountName: z.string().min(2).optional(),
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
  bankAccountNumber: z.string().length(10).optional(),
  bankCode: z.string().min(1).optional(),
  bankAccountName: z.string().min(2).optional(),
  avgDeliveryMinutes: z.number().int().positive().optional(), // static estimate, not computed — see schema.prisma
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
  isQuickBuy: z.boolean().optional(), // curated, not computed — see schema.prisma
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

// ── Response shapes ─────────────────────────────────────────────────────
// Hand-written wire contracts, not re-exported from Prisma — see admin.ts
// for why (a Date becomes a string once it round-trips through JSON, and
// Prisma's own types aren't meant for a browser bundle).

export interface CategoryDto {
  id: string;
  name: string;
  defaultPrepMinutes: number;
  isActive: boolean;
}

export interface ProductDto {
  id: string;
  vendorId: string;
  categoryId: string;
  name: string;
  description: string | null;
  priceMinor: number;
  images: string[];
  stock: number;
  isActive: boolean;
  isQuickBuy: boolean;
}

// GET /vendors and /vendors/:id share this shape — the search list just
// happens to omit nothing today, so there's no separate "summary" type.
export interface VendorDto {
  id: string;
  businessName: string;
  description: string | null;
  logoUrl: string | null;
  category: { id: string; name: string };
  isOpen: boolean;
  supportsPickup: boolean;
  reliabilityScore: string; // Prisma Decimal serializes as a string over JSON
  pickupLandmark: string;
  avgDeliveryMinutes: number | null;
  foundingVendorCommissionWaivedUntil: string | null;
}

// GET/PATCH /vendors/me — the raw VendorProfile row, unlike VendorDto
// above (a public, storefront-shaped view). Distinct type rather than a
// union of optional fields: `status`, `pickupLat`/`pickupLng`,
// `bankAccountNumber` etc. genuinely never appear on the public shape at all.
export interface OwnVendorProfileDto {
  id: string;
  userId: string;
  businessName: string;
  categoryId: string;
  description: string | null;
  logoUrl: string | null;
  pickupLat: number;
  pickupLng: number;
  pickupLandmark: string;
  pickupPhone: string;
  bankAccountNumber: string | null;
  bankCode: string | null;
  bankAccountName: string | null;
  status: VendorStatus;
  isOpen: boolean;
  supportsPickup: boolean;
  openingHours: Record<string, [string, string]>;
  reliabilityScore: string; // Decimal serializes as a string over JSON
  avgDeliveryMinutes: number | null;
  foundingVendorCommissionWaivedUntil: string | null;
  createdAt: string;
}
