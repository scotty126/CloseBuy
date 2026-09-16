import { z } from "zod";
import type { RiderStatus, OrderStatus, PaymentMethod } from "./enums.js";

// US-R-01 — same shape of decision as vendor onboarding (catalog.ts):
// identity is already established via phone OTP (staff auth), this just
// captures the role-specific application details.
export const riderApplicationSchema = z.object({
  fullName: z.string().min(2).max(100),
  vehicleType: z.enum(["bicycle", "motorcycle", "car"]),
  // File upload isn't built yet (R2, ADR-0001) — accepted as a URL for
  // now, same known gap as Product.images in catalog.ts.
  idDocumentUrl: z.string().url(),
  bankAccountRef: z.string().optional(),
});
export type RiderApplicationInput = z.infer<typeof riderApplicationSchema>;

export const setDutySchema = z.object({
  onDuty: z.boolean(),
});
export type SetDutyInput = z.infer<typeof setDutySchema>;

// US-R-05 — proof of delivery is a photo, a recipient name, or a code
// (brief's own wording is "or"), so at least one is required but none is
// individually mandatory.
export const confirmDeliverySchema = z
  .object({
    photoUrl: z.string().url().optional(),
    recipientName: z.string().min(1).optional(),
    code: z.string().optional(),
    // Required and checked against the order's exact total when
    // payment_method is cash_on_delivery; ignored otherwise.
    cashCollectedMinor: z.number().int().nonnegative().optional(),
  })
  .refine((v) => v.photoUrl || v.recipientName || v.code, {
    message: "At least one form of proof of delivery is required (photo, recipient name, or code).",
  });
export type ConfirmDeliveryInput = z.infer<typeof confirmDeliverySchema>;

export const confirmCollectionSchema = z.object({
  code: z.string().length(6),
});
export type ConfirmCollectionInput = z.infer<typeof confirmCollectionSchema>;

export const deliveryFailedSchema = z.object({
  reason: z.enum(["customer_unreachable", "wrong_address", "customer_refused", "other"]),
  notes: z.string().max(500).optional(),
});
export type DeliveryFailedInput = z.infer<typeof deliveryFailedSchema>;

// ── Response shapes ─────────────────────────────────────────────────────
// Hand-written wire contracts, not re-exported from Prisma — see admin.ts
// for why.

export interface RiderProfileDto {
  id: string;
  userId: string;
  fullName: string;
  vehicleType: string;
  idDocumentUrl: string | null;
  bankAccountRef: string | null;
  status: RiderStatus;
  onDuty: boolean;
  cashBalanceMinor: number;
  createdAt: string;
}

// GET /riders/me/offers (unclaimed), the result of POST .../accept, and
// GET /riders/me/active-job (already claimed) all share this shape — the
// backend never models a separate "offer" entity (dispatch/service.ts),
// an unclaimed READY_FOR_PICKUP delivery order *is* the offer.
export interface RiderJobDto {
  id: string;
  vendorId: string;
  status: OrderStatus;
  collectionCode: string | null;
  paymentMethod: PaymentMethod;
  totalMinor: number;
  deliveryFeeMinor: number;
  deliveryLat: number;
  deliveryLng: number;
  deliveryLandmark: string;
  contactPhone: string;
  alternateContactPhone: string | null;
  updatedAt: string;
  vendor: {
    businessName: string;
    pickupLat: number;
    pickupLng: number;
    pickupLandmark: string;
    pickupPhone: string;
  };
}

export interface RiderEarningsDto {
  clearedMinor: number;
  pendingMinor: number;
  cashBalanceMinor: number;
  deliveries: Array<{ orderId: string; amountMinor: number; completedAt: string }>;
}
