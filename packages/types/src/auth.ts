import { z } from "zod";
import { USER_ROLES } from "./enums.js";

// Brief §3.1b: vendor/rider/admin use phone + OTP; customers never do.
export const STAFF_ROLES = ["vendor", "rider", "admin"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

// E.164 format, Nigerian numbers in practice at launch (brief A-01) but not
// hard-restricted here — validation of "is this actually deliverable" is
// Termii's job, not ours.
export const phoneSchema = z
  .string()
  .regex(/^\+[1-9]\d{7,14}$/, "Phone number must be in E.164 format, e.g. +2348012345678");

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters");

// ── Vendor / rider / admin — phone + OTP (unchanged from M0) ──────────────

export const otpRequestSchema = z.object({
  phone: phoneSchema,
});
export type OtpRequestInput = z.infer<typeof otpRequestSchema>;

export const otpVerifySchema = z.object({
  phone: phoneSchema,
  code: z.string().length(6, "Code must be 6 digits"),
  // Required, not optional — this path is never a customer's (brief §3.1b).
  // US-V-01 / US-R-01 each collect their own role-specific profile after
  // this step.
  role: z.enum(STAFF_ROLES),
});
export type OtpVerifyInput = z.infer<typeof otpVerifySchema>;

// ── Customer — email/password or Google/Apple (brief §3.1b) ───────────────

export const registerSchema = z.object({
  email: z.string().email(),
  password: passwordSchema,
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

// ── Shared ──────────────────────────────────────────────────────────────

export const authSessionSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  user: z.object({
    id: z.string().uuid(),
    role: z.enum(USER_ROLES),
    // Populated depending on which identity field this role actually uses
    // (brief §3.1b) — a customer session has email set and phone null; a
    // staff session has the reverse.
    email: z.string().nullable(),
    emailVerifiedAt: z.string().datetime().nullable(),
    phone: z.string().nullable(),
    phoneVerifiedAt: z.string().datetime().nullable(),
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
