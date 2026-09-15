import { z } from "zod";
import { phoneSchema } from "./auth.js";
import { FULFILMENT_TYPES, PAYMENT_METHODS } from "./enums.js";

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
