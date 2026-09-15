import { z } from "zod";
import { USER_ROLES } from "./enums.js";

// E.164 format, Nigerian numbers in practice at launch (brief A-01) but not
// hard-restricted here — validation of "is this actually deliverable" is
// Termii's job, not ours.
export const phoneSchema = z
  .string()
  .regex(/^\+[1-9]\d{7,14}$/, "Phone number must be in E.164 format, e.g. +2348012345678");

export const otpRequestSchema = z.object({
  phone: phoneSchema,
});
export type OtpRequestInput = z.infer<typeof otpRequestSchema>;

export const otpVerifySchema = z.object({
  phone: phoneSchema,
  code: z.string().length(6, "Code must be 6 digits"),
  // Only meaningful on first verification for a brand-new phone number —
  // ignored for a returning user. US-C-01 / US-V-01 / US-R-01 each collect
  // their own role-specific profile after this step.
  role: z.enum(USER_ROLES).optional(),
});
export type OtpVerifyInput = z.infer<typeof otpVerifySchema>;

export const authSessionSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  user: z.object({
    id: z.string().uuid(),
    phone: z.string(),
    role: z.enum(USER_ROLES),
    phoneVerifiedAt: z.string().datetime(),
  }),
});
export type AuthSession = z.infer<typeof authSessionSchema>;

export const refreshRequestSchema = z.object({
  refreshToken: z.string(),
});
export type RefreshRequestInput = z.infer<typeof refreshRequestSchema>;

/**
 * The JWT payload shape issued by the Auth module and expected by every
 * other module's auth guard (architecture.md §2). Kept minimal deliberately
 * — role and ownership checks against the database happen per-request, this
 * is not a capability token.
 */
export interface AccessTokenClaims {
  sub: string; // user id
  role: (typeof USER_ROLES)[number];
  iat: number;
  exp: number;
}
