import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import { hashPassword, verifyPassword } from "../../../lib/password.js";
import type { EmailClient } from "./email.js";
import { signAccessToken, signRefreshToken } from "../../../lib/jwt.js";

const MAX_LOGIN_ATTEMPTS = 5; // US-C-01 — same brute-force protection the old OTP lockout had
const LOGIN_LOCKOUT_WINDOW_SECONDS = 15 * 60;
const RESET_TOKEN_TTL_SECONDS = 60 * 60; // 1 hour
const VERIFY_TOKEN_TTL_SECONDS = 24 * 60 * 60; // 24 hours — non-blocking, so a generous window is fine

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

export class InvalidResetTokenError extends Error {
  constructor() {
    super("This reset link is invalid or has expired.");
  }
}

export interface CustomerAuthDeps {
  prisma: PrismaClient;
  redis: Redis;
  email: EmailClient;
  jwtAccessSecret: string;
  jwtRefreshSecret: string;
  passwordPepper: string;
  appBaseUrl: string; // where verify/reset links point — the customer app, not the API
}

const loginAttemptsKey = (email: string) => `login:attempts:${email}`;
const verifyTokenKey = (token: string) => `email-verify:${token}`;
const resetTokenKey = (token: string) => `password-reset:${token}`;

function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

export function createCustomerAuthService(deps: CustomerAuthDeps) {
  function issueSession(user: { id: string; role: string }) {
    return {
      accessToken: signAccessToken(user.id, user.role as never, deps.jwtAccessSecret),
      refreshToken: signRefreshToken(user.id, deps.jwtRefreshSecret),
    };
  }

  return {
    /** US-C-01: email + password sign-up. Issues a session immediately — verification is a courtesy, not a gate. */
    async register(email: string, password: string) {
      // email is unique per (email, role) (schema.prisma) — this file is
      // customer-only, so "customer" is hardcoded rather than threaded
      // through as a param everywhere, unlike email.ts's staff version.
      const existing = await deps.prisma.user.findUnique({ where: { email_role: { email, role: "customer" } } });
      if (existing) throw new EmailAlreadyRegisteredError();

      const passwordHash = await hashPassword(password, deps.passwordPepper);
      const user = await deps.prisma.user.create({
        data: { email, passwordHash, role: "customer", customerProfile: { create: {} } },
      });

      const verifyToken = randomToken();
      try {
        await deps.redis.set(verifyTokenKey(verifyToken), user.id, "EX", VERIFY_TOKEN_TTL_SECONDS);
        await deps.email
          .sendVerificationEmail(email, `${deps.appBaseUrl}/verify-email?token=${verifyToken}`)
          .catch((err) => {
            // Never fail signup because the courtesy email didn't send —
            // logged, not thrown. The account is fully usable either way.
            console.error("Failed to send verification email:", err);
          });
      } catch (err) {
        // Same non-gating guarantee as the email send above — the user row
        // is already committed, so a flaky Redis here must not strand it
        // unverified with no way to ever retry (email is taken either way).
        console.error("Failed to store email verification token:", err);
      }

      return { user, ...issueSession(user) };
    },

    /** US-C-01: email + password sign-in, with the same lockout spirit the old OTP flow had. */
    async login(email: string, password: string) {
      const attempts = Number((await deps.redis.get(loginAttemptsKey(email))) ?? 0);
      if (attempts >= MAX_LOGIN_ATTEMPTS) {
        throw new LoginLockedError();
      }

      const user = await deps.prisma.user.findUnique({ where: { email_role: { email, role: "customer" } } });
      const valid = user?.passwordHash
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

    /** US-C-01: always succeeds from the caller's point of view — never reveals whether the email exists. */
    async requestPasswordReset(email: string): Promise<void> {
      const user = await deps.prisma.user.findUnique({ where: { email_role: { email, role: "customer" } } });
      if (!user || !user.passwordHash) return; // no account, or an OAuth-only account with no password to reset

      const token = randomToken();
      await deps.redis.set(resetTokenKey(token), user.id, "EX", RESET_TOKEN_TTL_SECONDS);
      await deps.email.sendPasswordResetEmail(email, `${deps.appBaseUrl}/reset-password?token=${token}`);
    },

    async resetPassword(token: string, newPassword: string) {
      const userId = await deps.redis.get(resetTokenKey(token));
      if (!userId) throw new InvalidResetTokenError();

      await deps.redis.del(resetTokenKey(token)); // single-use
      const passwordHash = await hashPassword(newPassword, deps.passwordPepper);
      await deps.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    },

    async verifyEmail(token: string): Promise<boolean> {
      const userId = await deps.redis.get(verifyTokenKey(token));
      if (!userId) return false;

      await deps.redis.del(verifyTokenKey(token));
      await deps.prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
      return true;
    },

    // Google/Apple sign-in used to live here (customer-only, brief §3.1b's
    // original scope) — moved to ../oauth-account.js and generalized once
    // vendor/rider/admin needed it too; ../oauth-routes.js is the caller
    // now, for every role including this one.
  };
}

export type CustomerAuthService = ReturnType<typeof createCustomerAuthService>;
