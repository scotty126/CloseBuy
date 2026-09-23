import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Redis } from "ioredis";
import type { PrismaClient } from "@prisma/client";
import {
  createStaffEmailAuthService,
  EmailAlreadyRegisteredError,
  InvalidCredentialsError,
  LoginLockedError,
  AdminSelfRegistrationDisabledError,
} from "./email.js";

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

// Keyed by (email, role) — schema.prisma's real composite unique, now
// that the same email can hold a vendor row AND a rider row AND an admin
// row at once.
function createFakePrisma(seed?: Array<{ email: string; role: string; passwordHash?: string }>): PrismaClient {
  const users = new Map<string, any>();
  const key = (email: string, role: string) => `${email}:${role}`;
  for (const u of seed ?? []) {
    users.set(key(u.email, u.role), { id: `seed_${u.email}_${u.role}`, ...u });
  }

  return {
    user: {
      findUnique: vi.fn(async ({ where }: any) => users.get(key(where.email_role.email, where.email_role.role)) ?? null),
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `user_${users.size + 1}`, ...data };
        users.set(key(data.email, data.role), row);
        return row;
      }),
    },
  } as unknown as PrismaClient;
}

const DEPS_BASE = {
  jwtAccessSecret: "test-secret-at-least-32-characters-long",
  jwtRefreshSecret: "test-secret-at-least-32-characters-long-2",
  passwordPepper: "test-pepper-at-least-32-characters-long",
};

describe("staff email/password — register", () => {
  let redis: Redis;
  let prisma: PrismaClient;

  beforeEach(() => {
    redis = createFakeRedis();
    prisma = createFakePrisma();
  });

  it("creates a vendor account and issues a session", async () => {
    const svc = createStaffEmailAuthService({ prisma, redis, ...DEPS_BASE });
    const result = await svc.register("vendor@example.com", "password123", "vendor");

    expect(result.user.role).toBe("vendor");
    expect(result.accessToken).toEqual(expect.any(String));
  });

  it("rejects a second registration with the same email AND role", async () => {
    const svc = createStaffEmailAuthService({ prisma, redis, ...DEPS_BASE });
    await svc.register("vendor@example.com", "password123", "vendor");

    await expect(svc.register("vendor@example.com", "password456", "vendor")).rejects.toThrow(
      EmailAlreadyRegisteredError,
    );
  });

  it("the same email independently registers as a vendor account AND a rider account (unique per (email, role), not globally)", async () => {
    const svc = createStaffEmailAuthService({ prisma, redis, ...DEPS_BASE });
    const vendorResult = await svc.register("same@example.com", "password123", "vendor");
    const riderResult = await svc.register("same@example.com", "password456", "rider");

    expect(vendorResult.user.role).toBe("vendor");
    expect(riderResult.user.role).toBe("rider");
    expect(vendorResult.user.id).not.toBe(riderResult.user.id);
  });

  it("never creates an admin account via self-registration, whatever the caller claims", async () => {
    const svc = createStaffEmailAuthService({ prisma, redis, ...DEPS_BASE });

    await expect(svc.register("someone@example.com", "password123", "admin")).rejects.toThrow(
      AdminSelfRegistrationDisabledError,
    );
    expect((prisma.user as any).create).not.toHaveBeenCalled();
  });
});

describe("staff email/password — login", () => {
  it("signs in with the correct password and matching role", async () => {
    const redis = createFakeRedis();
    const prisma = createFakePrisma();
    const svc = createStaffEmailAuthService({ prisma, redis, ...DEPS_BASE });
    await svc.register("vendor@example.com", "password123", "vendor");

    const result = await svc.login("vendor@example.com", "password123", "vendor");
    expect(result.user.role).toBe("vendor");
  });

  it("rejects the wrong password", async () => {
    const redis = createFakeRedis();
    const prisma = createFakePrisma();
    const svc = createStaffEmailAuthService({ prisma, redis, ...DEPS_BASE });
    await svc.register("vendor@example.com", "password123", "vendor");

    await expect(svc.login("vendor@example.com", "wrong-password", "vendor")).rejects.toThrow(
      InvalidCredentialsError,
    );
  });

  it("rejects a correct password used on the wrong app's role, even though the email is real", async () => {
    const redis = createFakeRedis();
    const prisma = createFakePrisma();
    const svc = createStaffEmailAuthService({ prisma, redis, ...DEPS_BASE });
    await svc.register("vendor@example.com", "password123", "vendor");

    // Same email, same password, but attempted on the rider app's login —
    // there's no (email, "rider") row at all, so this can't resolve to
    // the vendor row by accident.
    await expect(svc.login("vendor@example.com", "password123", "rider")).rejects.toThrow(InvalidCredentialsError);
  });

  it("locks the account after 5 failed attempts within the window", async () => {
    const redis = createFakeRedis();
    const prisma = createFakePrisma();
    const svc = createStaffEmailAuthService({ prisma, redis, ...DEPS_BASE });
    await svc.register("vendor@example.com", "password123", "vendor");

    for (let i = 0; i < 5; i++) {
      await expect(svc.login("vendor@example.com", "wrong", "vendor")).rejects.toThrow(InvalidCredentialsError);
    }
    await expect(svc.login("vendor@example.com", "password123", "vendor")).rejects.toThrow(LoginLockedError);
  });
});
