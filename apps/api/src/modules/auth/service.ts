import type { PrismaClient, User } from "@prisma/client";
import type { Redis } from "ioredis";
import type { StaffRole } from "@closebuy/types";
import type { TermiiClient } from "./termii.js";
import { signAccessToken, signRefreshToken } from "../../lib/jwt.js";

// Vendor/rider/admin only — customers use email/password or OAuth instead
// (brief §3.1b, apps/api/src/modules/auth/customer/). This module still
// covers phone+OTP specifically; email/password and OAuth for staff roles
// live in ./email.js and ./oauth-routes.js.
const MAX_ATTEMPTS = 5; // US-V-01 / US-R-01
const LOCKOUT_WINDOW_SECONDS = 15 * 60;
const PIN_TTL_SECONDS = 10 * 60; // matches Termii's pin_time_to_live

export class OtpLockedError extends Error {
  constructor() {
    super("Too many failed attempts. Try again later.");
  }
}

export class OtpInvalidError extends Error {
  constructor() {
    super("Invalid or expired code.");
  }
}

/**
 * Shared by requestOtp's auto-signin fast path and verifyOtp's real
 * success path, so "who's allowed a session for this (phone, role)" is
 * decided in exactly one place. Vendor/rider are genuinely self-service —
 * proving control of a phone number is enough to start an application
 * (US-V-01/US-R-01), so this upserts. Admin is not: nothing about owning a
 * fresh phone number should be able to mint an admin session, or every
 * check the Admin module gates behind requireAuth(["admin"]) means
 * nothing. Admin Users are provisioned out of band (prisma/seed.ts's
 * SEED_ADMIN_PHONE locally; a one-off script in production) — this
 * returns `null` rather than creating one, so the caller can fail closed.
 */
async function findOrCreateStaffUser(prisma: PrismaClient, phone: string, role: StaffRole): Promise<User | null> {
  if (role === "admin") {
    const existing = await prisma.user.findUnique({ where: { phone_role: { phone, role: "admin" } } });
    if (!existing) return null;
    return prisma.user.update({ where: { phone_role: { phone, role: "admin" } }, data: { phoneVerifiedAt: new Date() } });
  }
  return prisma.user.upsert({
    where: { phone_role: { phone, role } },
    update: { phoneVerifiedAt: new Date() },
    create: { phone, role, phoneVerifiedAt: new Date() },
  });
}

export interface AuthDeps {
  prisma: PrismaClient;
  redis: Redis;
  termii: TermiiClient;
  jwtAccessSecret: string;
  jwtRefreshSecret: string;
  // Comma-separated E.164 numbers (env.ts's DEV_AUTO_SIGNIN_PHONES) that
  // skip Termii/OTP entirely on requestOtp — empty in every environment
  // that hasn't deliberately set it. See requestOtp's own comment.
  devAutoSigninPhones: string;
}

const attemptsKey = (phone: string) => `otp:attempts:${phone}`;
const pinIdKey = (phone: string) => `otp:pinid:${phone}`;

export function createAuthService(deps: AuthDeps) {
  const autoSigninPhones = new Set(
    deps.devAutoSigninPhones
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean),
  );

  function issueSession(user: User) {
    return {
      accessToken: signAccessToken(user.id, user.role, deps.jwtAccessSecret),
      refreshToken: signRefreshToken(user.id, deps.jwtRefreshSecret),
    };
  }

  return {
    /**
     * The "type your number, you're in" shortcut — checked by the route
     * BEFORE its otpUnavailable/Termii gate (routes.ts), specifically so
     * this still works when Termii isn't configured at all, which is
     * exactly the situation it exists for. Returns `null` for any phone
     * not in `devAutoSigninPhones` (env.ts's DEV_AUTO_SIGNIN_PHONES,
     * empty unless deliberately set) or with no eligible account yet
     * (e.g. admin not provisioned) — the caller falls through to the
     * normal OTP flow either way, never a hard failure.
     */
    async tryAutoSignin(
      phone: string,
      role: StaffRole,
    ): Promise<{ user: User; accessToken: string; refreshToken: string } | null> {
      if (!autoSigninPhones.has(phone)) return null;
      const user = await findOrCreateStaffUser(deps.prisma, phone, role);
      return user ? { user, ...issueSession(user) } : null;
    },

    /** US-C-01: request a fresh code, whether the number is new or returning. */
    async requestOtp(phone: string): Promise<{ devCode?: string }> {
      const locked = await deps.redis.get(attemptsKey(phone));
      if (locked && Number(locked) >= MAX_ATTEMPTS) {
        throw new OtpLockedError();
      }

      const { pinId, devCode } = await deps.termii.sendOtp(phone);
      await deps.redis.set(pinIdKey(phone), pinId, "EX", PIN_TTL_SECONDS);
      return { devCode };
    },

    /**
     * US-V-01 / US-R-01: verify a code, issue a session. Creates the User
     * row on first successful verification for a brand-new phone number.
     * `role` is required and restricted to staff roles at the type level —
     * a customer never reaches this function (brief §3.1b).
     */
    async verifyOtp(phone: string, code: string, role: StaffRole) {
      const attempts = Number((await deps.redis.get(attemptsKey(phone))) ?? 0);
      if (attempts >= MAX_ATTEMPTS) {
        throw new OtpLockedError();
      }

      const pinId = await deps.redis.get(pinIdKey(phone));
      if (!pinId) {
        throw new OtpInvalidError(); // expired or never requested
      }

      const { verified } = await deps.termii.verifyOtp(pinId, code);
      if (!verified) {
        await deps.redis
          .multi()
          .incr(attemptsKey(phone))
          .expire(attemptsKey(phone), LOCKOUT_WINDOW_SECONDS)
          .exec();
        throw new OtpInvalidError();
      }

      // Success — clear the attempt counter and the one-time pin reference.
      await deps.redis.del(attemptsKey(phone), pinIdKey(phone));

      // findOrCreateStaffUser (above) carries the admin-safeguard reasoning
      // — a phone with no admin User row fails exactly like a wrong code
      // would, so this doesn't double as an oracle for which numbers are
      // admins.
      const user = await findOrCreateStaffUser(deps.prisma, phone, role);
      if (!user) throw new OtpInvalidError();

      return { user, ...issueSession(user) };
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
