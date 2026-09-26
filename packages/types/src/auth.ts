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

// ── Vendor / rider / admin — phone + OTP, or email + password ─────────────
// (brief §3.1b's original "staff = phone only" relaxed once Termii turned
// out to be a real, months-long bottleneck — see apps/api's auth/email.ts.)

export const otpRequestSchema = z.object({
  phone: phoneSchema,
  // Required — the calling app already knows which one it is (vendor app
  // only ever means vendor), and the API needs it up front now too: the
  // dev auto-signin fast path (apps/api's auth/service.ts) can only mint
  // a session for a known role, and User.phone is unique per (phone,
  // role), not globally, so even the plain "does this number already
  // have an account" question needs a role to be well-formed.
  role: z.enum(STAFF_ROLES),
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

export const staffRegisterSchema = z.object({
  email: z.string().email(),
  password: passwordSchema,
  role: z.enum(STAFF_ROLES),
});
export type StaffRegisterInput = z.infer<typeof staffRegisterSchema>;

export const staffLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  role: z.enum(STAFF_ROLES),
});
export type StaffLoginInput = z.infer<typeof staffLoginSchema>;

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

/**
 * POST /auth/otp/request's response, shared so the server and the three
 * staff login pages can't drift apart again: the route returned the session's
 * fields at the top level while every login page waited for `res.session`, so
 * the DEV_AUTO_SIGNIN_PHONES shortcut never once worked from the UI (2026-09-26;
 * present since the commit that introduced both). Exactly one of the two
 * fields is ever set — `session` for an allowlisted number, `devCode` for the
 * OTP_DEV_FALLBACK path — and neither for a real Termii send (204, no body).
 */
export interface OtpRequestResponse {
  devCode?: string;
  session?: AuthSession;
}

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
