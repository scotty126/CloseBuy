import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import type { TermiiClient } from "./termii.js";
import { signAccessToken, signRefreshToken } from "../../lib/jwt.js";

const MAX_ATTEMPTS = 5; // US-C-01
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
    async requestOtp(phone: string): Promise<void> {
      const locked = await deps.redis.get(attemptsKey(phone));
      if (locked && Number(locked) >= MAX_ATTEMPTS) {
        throw new OtpLockedError();
      }

      const { pinId } = await deps.termii.sendOtp(phone);
      await deps.redis.set(pinIdKey(phone), pinId, "EX", PIN_TTL_SECONDS);
    },

    /**
     * US-C-01: verify a code, issue a session. Creates the User row on
     * first successful verification for a brand-new phone number.
     */
    async verifyOtp(phone: string, code: string, role: "customer" | "vendor" | "rider" | "admin" = "customer") {
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

      const user = await deps.prisma.user.upsert({
        where: { phone },
        update: { phoneVerifiedAt: new Date() },
        create: { phone, role, phoneVerifiedAt: new Date() },
      });

      const accessToken = signAccessToken(user.id, user.role, deps.jwtAccessSecret);
      const refreshToken = signRefreshToken(user.id, deps.jwtRefreshSecret);

      return { user, accessToken, refreshToken };
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
