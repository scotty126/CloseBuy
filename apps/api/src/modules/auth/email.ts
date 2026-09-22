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
 * `email` stays globally unique (schema.prisma — unlike `phone`, not
 * relaxed to per-role) so registering here can reuse the same
 * "does this email already exist" check customer's register() uses,
 * unchanged. One consequence: a real person can't use the exact same
 * email for both their vendor account and their rider account — not
 * asked for here, and phone+OTP already covers "same identity, several
 * staff roles" via the per-role phone key instead.
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

const loginAttemptsKey = (email: string) => `staff-login:attempts:${email}`;

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

      const existing = await deps.prisma.user.findUnique({ where: { email } });
      if (existing) throw new EmailAlreadyRegisteredError();

      const passwordHash = await hashPassword(password, deps.passwordPepper);
      const user = await deps.prisma.user.create({ data: { email, passwordHash, role } });

      return { user, ...issueSession(user) };
    },

    /**
     * `role` is required, same reason otpVerifySchema's is (@closebuy/types):
     * this app only ever means one role, and a valid password for a
     * DIFFERENT role's account (or a customer's) must not work here even
     * though email is globally unique and would otherwise resolve to a
     * real row.
     */
    async login(email: string, password: string, role: StaffRole) {
      const attempts = Number((await deps.redis.get(loginAttemptsKey(email))) ?? 0);
      if (attempts >= MAX_LOGIN_ATTEMPTS) {
        throw new LoginLockedError();
      }

      const user = await deps.prisma.user.findUnique({ where: { email } });
      const valid =
        user?.passwordHash && user.role === role
          ? await verifyPassword(user.passwordHash, password, deps.passwordPepper)
          : false;

      if (!user || !valid) {
        await deps.redis
          .multi()
          .incr(loginAttemptsKey(email))
          .expire(loginAttemptsKey(email), LOGIN_LOCKOUT_WINDOW_SECONDS)
          .exec();
        throw new InvalidCredentialsError();
      }

      await deps.redis.del(loginAttemptsKey(email));
      return { user, ...issueSession(user) };
    },
  };
}

export type StaffEmailAuthService = ReturnType<typeof createStaffEmailAuthService>;
