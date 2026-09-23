import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Redis } from "ioredis";
import type { PrismaClient, User } from "@prisma/client";
import {
  createCustomerAuthService,
  EmailAlreadyRegisteredError,
  InvalidCredentialsError,
  LoginLockedError,
  InvalidResetTokenError,
} from "./service.js";
import type { EmailClient } from "./email.js";

/** Same minimal in-memory Redis fake as the staff auth tests (../service.test.ts) — kept separate rather than shared, since the two modules should stay decoupled. */
function createFakeRedis(): Redis {
  const store = new Map<string, string>();
  const fake = {
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: string) => {
      store.set(key, value);
      return "OK";
    },
    del: async (...keys: string[]) => {
      let count = 0;
      for (const k of keys) if (store.delete(k)) count++;
      return count;
    },
    multi: () => {
      const ops: Array<() => void> = [];
      const chain = {
        incr(key: string) {
          ops.push(() => store.set(key, String(Number(store.get(key) ?? "0") + 1)));
          return chain;
        },
        expire() {
          ops.push(() => {});
          return chain;
        },
        exec: async () => {
          ops.forEach((op) => op());
          return [];
        },
      };
      return chain;
    },
  };
  return fake as unknown as Redis;
}

function createFakeEmail(): EmailClient {
  return {
    sendVerificationEmail: vi.fn().mockResolvedValue(undefined),
    sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined),
  };
}

/** Minimal in-memory fake Prisma — just the `user` model operations this service actually calls. */
function createFakePrisma() {
  const users = new Map<string, User>();
  let nextId = 1;

  return {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { email_role?: { email: string; role: string }; id?: string } }) => {
        // email is unique per (email, role) now (schema.prisma) — this
        // file only ever registers "customer" rows, matching real usage.
        if (where.email_role) {
          return [...users.values()].find((u) => u.email === where.email_role!.email && u.role === where.email_role!.role) ?? null;
        }
        if (where.id) return users.get(where.id) ?? null;
        return null;
      }),
      create: vi.fn(async ({ data }: { data: Partial<User> }) => {
        const user = {
          id: `user_${nextId++}`,
          role: "customer",
          email: data.email ?? null,
          passwordHash: data.passwordHash ?? null,
          emailVerifiedAt: data.emailVerifiedAt ?? null,
          phone: null,
          phoneVerifiedAt: null,
          createdAt: new Date(),
        } as User;
        users.set(user.id, user);
        return user;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<User> }) => {
        const existing = users.get(where.id);
        if (!existing) throw new Error("not found");
        const updated = { ...existing, ...data };
        users.set(where.id, updated);
        return updated;
      }),
    },
  } as unknown as PrismaClient;
}

const EMAIL = "shopper@example.com";
const PASSWORD = "correct-horse-battery-staple";

describe("customer auth service — US-C-01", () => {
  let redis: Redis;
  let email: EmailClient;
  let prisma: PrismaClient;

  beforeEach(() => {
    redis = createFakeRedis();
    email = createFakeEmail();
    prisma = createFakePrisma();
  });

  function service() {
    return createCustomerAuthService({
      prisma,
      redis,
      email,
      jwtAccessSecret: "test-secret-at-least-32-characters-long",
      jwtRefreshSecret: "test-secret-at-least-32-characters-long-2",
      passwordPepper: "test-pepper-at-least-32-characters-long",
      appBaseUrl: "http://localhost:3000",
    });
  }

  it("registers a new account and issues a session immediately", async () => {
    const svc = service();
    const result = await svc.register(EMAIL, PASSWORD);

    expect(result.user.email).toBe(EMAIL);
    expect(result.accessToken).toEqual(expect.any(String));
    expect(email.sendVerificationEmail).toHaveBeenCalledWith(EMAIL, expect.stringContaining("/verify-email?token="));
  });

  it("still creates a usable account and session when the verification-token write fails (bad Redis)", async () => {
    redis.set = vi.fn().mockRejectedValue(new Error("redis down"));
    const svc = service();

    const result = await svc.register(EMAIL, PASSWORD);

    expect(result.user.email).toBe(EMAIL);
    expect(result.accessToken).toEqual(expect.any(String));
    expect(email.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it("rejects registering an email that's already taken", async () => {
    const svc = service();
    await svc.register(EMAIL, PASSWORD);

    await expect(svc.register(EMAIL, "a-different-password")).rejects.toThrow(EmailAlreadyRegisteredError);
  });

  it("logs in with the correct password", async () => {
    const svc = service();
    await svc.register(EMAIL, PASSWORD);

    const result = await svc.login(EMAIL, PASSWORD);
    expect(result.user.email).toBe(EMAIL);
  });

  it("rejects the wrong password without issuing a session", async () => {
    const svc = service();
    await svc.register(EMAIL, PASSWORD);

    await expect(svc.login(EMAIL, "wrong-password")).rejects.toThrow(InvalidCredentialsError);
  });

  it("rejects a login for an email that was never registered", async () => {
    const svc = service();
    await expect(svc.login("nobody@example.com", PASSWORD)).rejects.toThrow(InvalidCredentialsError);
  });

  it("locks the account after 5 failed attempts within the window (US-C-01)", async () => {
    const svc = service();
    await svc.register(EMAIL, PASSWORD);

    for (let i = 0; i < 5; i++) {
      await expect(svc.login(EMAIL, "wrong-password")).rejects.toThrow(InvalidCredentialsError);
    }

    // Locked out now — even the correct password is rejected until the window passes.
    await expect(svc.login(EMAIL, PASSWORD)).rejects.toThrow(LoginLockedError);
  });

  it("never reveals whether an email exists on password reset request", async () => {
    const svc = service();
    await svc.register(EMAIL, PASSWORD);

    // Both calls resolve identically from the caller's point of view.
    await expect(svc.requestPasswordReset(EMAIL)).resolves.toBeUndefined();
    await expect(svc.requestPasswordReset("nobody@example.com")).resolves.toBeUndefined();

    // But only the real account actually got an email.
    expect(email.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    expect(email.sendPasswordResetEmail).toHaveBeenCalledWith(EMAIL, expect.stringContaining("/reset-password?token="));
  });

  it("resets the password with a valid token, then the old password stops working", async () => {
    const svc = service();
    await svc.register(EMAIL, PASSWORD);
    await svc.requestPasswordReset(EMAIL);

    const sentUrl = (email.sendPasswordResetEmail as ReturnType<typeof vi.fn>).mock.calls[0]![1] as string;
    const token = new URL(sentUrl).searchParams.get("token")!;

    await svc.resetPassword(token, "a-brand-new-password");

    await expect(svc.login(EMAIL, PASSWORD)).rejects.toThrow(InvalidCredentialsError);
    const result = await svc.login(EMAIL, "a-brand-new-password");
    expect(result.user.email).toBe(EMAIL);
  });

  it("rejects an invalid or already-used reset token", async () => {
    const svc = service();
    await expect(svc.resetPassword("not-a-real-token", "whatever")).rejects.toThrow(InvalidResetTokenError);
  });

  it("verifies email with a valid token, and it's single-use", async () => {
    const svc = service();
    await svc.register(EMAIL, PASSWORD);

    const sentUrl = (email.sendVerificationEmail as ReturnType<typeof vi.fn>).mock.calls[0]![1] as string;
    const token = new URL(sentUrl).searchParams.get("token")!;

    await expect(svc.verifyEmail(token)).resolves.toBe(true);
    await expect(svc.verifyEmail(token)).resolves.toBe(false); // already consumed
  });
});
