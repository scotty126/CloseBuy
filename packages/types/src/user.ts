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
