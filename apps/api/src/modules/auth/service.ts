import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import type { StaffRole } from "@closebuy/types";
import type { TermiiClient } from "./termii.js";
import { signAccessToken, signRefreshToken } from "../../lib/jwt.js";

// Vendor/rider/admin only — customers use email/password or OAuth instead
// (brief §3.1b, apps/api/src/modules/auth/customer/).
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

export interface AuthDeps {
  prisma: PrismaClient;
  redis: Redis;
  termii: TermiiClient;
  jwtAccessSecret: string;
  jwtRefreshSecret: string;
}

const attemptsKey = (phone: string) => `otp:attempts:${phone}`;
const pinIdKey = (phone: string) => `otp:pinid:${phone}`;

export function createAuthService(deps: AuthDeps) {
  return {
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

      // Vendor/rider are genuinely self-service — proving control of a
      // phone number is enough to start an application (US-V-01/US-R-01).
      // Admin is not: nothing about owning a fresh phone number should be
      // able to mint an admin session, or every check the Admin module is
      // about to gate behind requireAuth(["admin"]) means nothing. Admin
      // Users are provisioned out of band (prisma/seed.ts's SEED_ADMIN_PHONE
      // locally; a one-off script in production) — this path only ever
      // logs an already-provisioned admin in, never creates one. A phone
      // with no admin User row fails exactly like a wrong code would, so
      // this doesn't double as an oracle for which numbers are admins.
      let user;
      if (role === "admin") {
        const existing = await deps.prisma.user.findUnique({ where: { phone } });
        if (!existing || existing.role !== "admin") {
          throw new OtpInvalidError();
        }
        user = await deps.prisma.user.update({ where: { phone }, data: { phoneVerifiedAt: new Date() } });
      } else {
        user = await deps.prisma.user.upsert({
          where: { phone },
          update: { phoneVerifiedAt: new Date() },
          create: { phone, role, phoneVerifiedAt: new Date() },
        });
      }

      const accessToken = signAccessToken(user.id, user.role, deps.jwtAccessSecret);
      const refreshToken = signRefreshToken(user.id, deps.jwtRefreshSecret);

      return { user, accessToken, refreshToken };
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
