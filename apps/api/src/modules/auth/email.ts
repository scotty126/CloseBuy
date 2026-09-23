import type { PrismaClient, User } from "@prisma/client";
import type { Redis } from "ioredis";
import type { StaffRole } from "@closebuy/types";
import { hashPassword, verifyPassword } from "../../lib/password.js";
import { signAccessToken, signRefreshToken } from "../../lib/jwt.js";

/**
 * Vendor/rider/admin, email + password — the alternative to phone+OTP
 * (service.ts) this module adds. Mirrors customer/service.ts's
 * register/login shape closely on purpose (same lockout window, same
 * argon2id hashing via the now-shared lib/password.ts) — the two auth
 * methods should feel identical from a security standpoint, they just
 * end up on different User rows.
 *
 * `email` is unique per (email, role) (schema.prisma), not globally — the
 * same real address can independently be a vendor account AND a rider
 * account AND an admin account, mirroring phone+OTP's per-role key.
 * Every lookup below is keyed on the composite, so "does this email
 * already exist" and "is this the right account for this app" are both
 * answered by the same query, not a query plus a separate role check.
 */

const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCKOUT_WINDOW_SECONDS = 15 * 60;

export class EmailAlreadyRegisteredError extends Error {
  constructor() {
    super("An account with this email already exists.");
  }
}

export class InvalidCredentialsError extends Error {
  constructor() {
    super("Incorrect email or password.");
  }
}

export class LoginLockedError extends Error {
  constructor() {
    super("Too many failed attempts. Try again later.");
  }
}

/**
 * Admin accounts are provisioned out of band only (same rule
 * service.ts's verifyOtp/findOrCreateStaffUser enforces for phone) — a
 * bare email+password sign-up must never be able to mint one. Login still
 * works normally for an admin whose account already has a password set.
 */
export class AdminSelfRegistrationDisabledError extends Error {
  constructor() {
    super("Admin accounts can't be created this way — ask an existing admin to set one up.");
  }
}

export interface StaffEmailAuthDeps {
  prisma: PrismaClient;
  redis: Redis;
  jwtAccessSecret: string;
  jwtRefreshSecret: string;
  passwordPepper: string;
}

// Attempts are tracked per (email, role) too — a lockout on the vendor
// app for this address doesn't also lock out the rider app for the same
// address, since they're genuinely separate accounts now.
const loginAttemptsKey = (email: string, role: StaffRole) => `staff-login:attempts:${role}:${email}`;

export function createStaffEmailAuthService(deps: StaffEmailAuthDeps) {
  function issueSession(user: User) {
    return {
      accessToken: signAccessToken(user.id, user.role, deps.jwtAccessSecret),
      refreshToken: signRefreshToken(user.id, deps.jwtRefreshSecret),
    };
  }

  return {
    /** Vendor/rider self-service, matching phone+OTP's trust level — proving control of an inbox is enough to start an application. */
    async register(email: string, password: string, role: StaffRole) {
      if (role === "admin") throw new AdminSelfRegistrationDisabledError();

      const existing = await deps.prisma.user.findUnique({ where: { email_role: { email, role } } });
      if (existing) throw new EmailAlreadyRegisteredError();

      const passwordHash = await hashPassword(password, deps.passwordPepper);
      const user = await deps.prisma.user.create({ data: { email, passwordHash, role } });

      return { user, ...issueSession(user) };
    },

    async login(email: string, password: string, role: StaffRole) {
      const attempts = Number((await deps.redis.get(loginAttemptsKey(email, role))) ?? 0);
      if (attempts >= MAX_LOGIN_ATTEMPTS) {
        throw new LoginLockedError();
      }

      const user = await deps.prisma.user.findUnique({ where: { email_role: { email, role } } });
      const valid = user?.passwordHash ? await verifyPassword(user.passwordHash, password, deps.passwordPepper) : false;

      if (!user || !valid) {
        await deps.redis
          .multi()
          .incr(loginAttemptsKey(email, role))
          .expire(loginAttemptsKey(email, role), LOGIN_LOCKOUT_WINDOW_SECONDS)
          .exec();
        throw new InvalidCredentialsError();
      }

      await deps.redis.del(loginAttemptsKey(email, role));
      return { user, ...issueSession(user) };
    },
  };
}

export type StaffEmailAuthService = ReturnType<typeof createStaffEmailAuthService>;
