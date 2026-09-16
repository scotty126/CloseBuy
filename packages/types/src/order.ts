import { z } from "zod";
import { phoneSchema } from "./auth.js";
import { FULFILMENT_TYPES, PAYMENT_METHODS } from "./enums.js";
import type { OrderStatus, FulfilmentType, PaymentMethod } from "./enums.js";

const cartItemSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().positive(),
});

/**
 * The cart is client-side state (brief §3.1b) — this is what actually
 * gets submitted, whole, at checkout. Every field here is re-validated
 * server-side (price, stock, the single-vendor rule) — see
 * api-contracts.md's note that checkout is the one place the server has
 * to stop trusting client state.
 */
export const checkoutSchema = z
  .object({
    vendorId: z.string().uuid(),
    items: z.array(cartItemSchema).min(1),
    fulfilmentType: z.enum(FULFILMENT_TYPES),
    scheduledFor: z.string().datetime().optional(),
    // Delivery-only fields
    addressId: z.string().uuid().optional(), // signed-in customer's saved address, for convenience only
    deliveryLat: z.number().min(-90).max(90).optional(),
    deliveryLng: z.number().min(-180).max(180).optional(),
    deliveryLandmark: z.string().min(3).max(200).optional(),
    paymentMethod: z.enum(PAYMENT_METHODS),
    // Brief §3.1b — always required, guest or signed-in; a signed-in
    // customer's client presets this from their profile, the server
    // doesn't infer it.
    contactPhone: phoneSchema,
    alternateContactPhone: phoneSchema.optional(),
    // Monnify's transaction-init requires an email for the receipt — a
    // signed-in customer's account email is used automatically; this is
    // only ever read for a guest paying by card/transfer, and even then
    // it's just where Monnify's own receipt goes, never used as an
    // identifier. Falls back to a synthesized placeholder if omitted.
    email: z.string().email().optional(),
  })
  .refine((v) => v.fulfilmentType !== "delivery" || (v.deliveryLat !== undefined && v.deliveryLng !== undefined && v.deliveryLandmark !== undefined), {
    message: "deliveryLat, deliveryLng and deliveryLandmark are required for delivery orders",
    path: ["deliveryLat"],
  })
  .refine((v) => v.fulfilmentType === "delivery" || v.paymentMethod !== "cash_on_delivery", {
    message: "cash_on_delivery is only valid for delivery orders — there is no delivery to pay on (brief §3.1a)",
    path: ["paymentMethod"],
  });
export type CheckoutInput = z.infer<typeof checkoutSchema>;

export const rejectOrderSchema = z.object({
  reason: z.string().min(3).max(300),
});
export type RejectOrderInput = z.infer<typeof rejectOrderSchema>;

export const confirmPickupSchema = z.object({
  code: z.string().length(6),
});
export type ConfirmPickupInput = z.infer<typeof confirmPickupSchema>;

export const rateOrderSchema = z.object({
  targetType: z.enum(["vendor", "rider"]),
  score: z.number().int().min(1).max(5),
  comment: z.string().max(500).optional(),
});
export type RateOrderInput = z.infer<typeof rateOrderSchema>;

export const disputeOrderSchema = z.object({
  reason: z.string().min(10).max(1000),
  evidence: z.array(z.string().url()).max(5).optional(),
});
export type DisputeOrderInput = z.infer<typeof disputeOrderSchema>;

// ── Response shapes ─────────────────────────────────────────────────────
// Hand-written wire contracts, not re-exported from Prisma — see admin.ts
// for why.

export interface OrderItemDto {
  id: string;
  productId: string;
  nameSnapshot: string;
  priceMinorSnapshot: number;
  quantity: number;
}

export interface OrderTransitionDto {
  id: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  actorType: "customer" | "vendor" | "rider" | "admin" | "system";
  reason: string | null;
  createdAt: string;
}

// GET /orders/track/:token and /orders/:id share this shape — vendor/rider
// are only ever present because order/service.ts's trackingInclude joins
// them in specifically for the tracking screen (screens-navigation.md
// §1.7); GET /orders (list) omits them, see OrderSummaryDto below.
export interface OrderDto {
  id: string;
  trackingToken: string;
  customerId: string | null;
  vendorId: string;
  riderId: string | null;
  contactPhone: string;
  alternateContactPhone: string | null;
  fulfilmentType: FulfilmentType;
  scheduledFor: string | null;
  collectionCode: string | null;
  // Delivery orders only. Customer-visible; deliberately absent (not just
  // null) from any vendor- or rider-facing read — see the schema comment
  // on Order.deliveryCode for why. Optional here because who's asking
  // determines whether the key exists in the response at all.
  deliveryCode?: string | null;
  deliveryLat: number | null;
  deliveryLng: number | null;
  deliveryLandmark: string | null;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  subtotalMinor: number;
  deliveryFeeMinor: number;
  discountMinor: number;
  commissionMinor: number;
  totalMinor: number;
  createdAt: string;
  updatedAt: string;
  items: OrderItemDto[];
  transitions: OrderTransitionDto[];
  vendor?: { businessName: string; pickupLandmark: string; pickupPhone: string; logoUrl: string | null };
  rider?: { fullName: string; user: { phone: string } } | null;
}

// GET /orders (US-C-09 history) — the raw Order row, no relations joined.
export type OrderSummaryDto = Omit<OrderDto, "items" | "transitions" | "vendor" | "rider">;

export interface CheckoutResponse {
  order: OrderDto;
  trackingToken: string;
  checkoutUrl?: string; // present only for card/transfer — Monnify's hosted payment page
  replay: boolean;
}

// GET /vendors/me/earnings — US-V-07. `orders` is only ever COMPLETED
// ones (commission is final only there); clearedMinor/pendingMinor cover
// the running balance screens-navigation.md §2.4 needs at a glance.
export interface VendorEarningsDto {
  clearedMinor: number;
  pendingMinor: number;
  foundingVendorCommissionWaivedUntil: string | null;
  orders: Array<{ orderId: string; grossMinor: number; commissionMinor: number; netMinor: number; completedAt: string }>;
}
