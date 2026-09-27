import { z } from "zod";
import type { UserRole } from "./enums.js";
import { phoneSchema } from "./auth.js";

export interface User {
  id: string;
  phone: string;
  phoneVerifiedAt: string | null; // ISO datetime; null blocks any ordering/selling/riding action
  role: UserRole;
  createdAt: string;
}

// brief §3.1b — presets the phone field at checkout; never verified, never
// the identity mechanism (that's still email/password/OAuth). Optional:
// clearing it is a valid PATCH, not an error.
export const customerProfileUpdateSchema = z.object({
  defaultPhone: phoneSchema.nullable(),
});
export type CustomerProfileUpdateInput = z.infer<typeof customerProfileUpdateSchema>;

export interface CustomerProfileDto {
  defaultPhone: string | null;
}

// US-C-05 — a saved pin, never a postal string (brief §3.4). Never
// authoritative for an order (data-model.md §"Address") — checkout always
// carries its own copied deliveryLat/deliveryLng/deliveryLandmark, this is
// only "reuse next time" convenience.
export const addressCreateSchema = z.object({
  label: z.string().trim().min(1, "Give this address a name, e.g. \"Home\".").max(60),
  lat: z.number(),
  lng: z.number(),
  landmarkDescription: z.string().trim().min(3, "Describe a nearby landmark so a rider can find it."),
  contactPhone: phoneSchema,
});
export type AddressCreateInput = z.infer<typeof addressCreateSchema>;

export const addressUpdateSchema = addressCreateSchema.partial();
export type AddressUpdateInput = z.infer<typeof addressUpdateSchema>;

export interface AddressDto {
  id: string;
  label: string;
  lat: number;
  lng: number;
  landmarkDescription: string;
  contactPhone: string;
  isWithinServiceArea: boolean;
}
