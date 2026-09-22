import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Redis } from "ioredis";
import type { PrismaClient } from "@prisma/client";
import { createAuthService, OtpInvalidError, OtpLockedError } from "./service.js";
import type { TermiiClient } from "./termii.js";

/**
 * Minimal in-memory fake covering exactly the Redis surface the auth
 * service uses (get/set/del/multi().incr().expire().exec()) — enough to
 * exercise the real US-C-01 rules without a live Redis instance.
 */
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
        expire(_key: string, _seconds: number) {
          // TTL isn't modelled by this fake — the lockout tests only care
          // about the attempt count crossing the threshold, not expiry.
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

function createFakeTermii(overrides?: Partial<TermiiClient>): TermiiClient {
  return {
    sendOtp: vi.fn().mockResolvedValue({ pinId: "pin_123" }),
    verifyOtp: vi.fn().mockResolvedValue({ verified: true }),
    ...overrides,
  };
}

/**
 * Keyed by (phone, role) — schema.prisma's real composite unique, now
 * that the same phone number can hold a vendor row AND a rider row AND
 * an admin row simultaneously. `seedAdmin` pre-provisions an admin row,
 * matching prisma/seed.ts's SEED_ADMIN_PHONE (admin is never self-service).
 */
function createFakePrisma(seedAdmin?: { phone: string }): PrismaClient {
  const users = new Map<string, any>();
  const key = (phone: string, role: string) => `${phone}:${role}`;
  if (seedAdmin) {
    users.set(key(seedAdmin.phone, "admin"), {
      id: "admin_1",
      phone: seedAdmin.phone,
      role: "admin",
      phoneVerifiedAt: null,
    });
  }

  return {
    user: {
      upsert: vi.fn(async ({ where, update, create }: any) => {
        const k = key(where.phone_role.phone, where.phone_role.role);
        const existing = users.get(k);
        const row = existing ? { ...existing, ...update } : { id: `user_${users.size + 1}`, ...create };
        users.set(k, row);
        return row;
      }),
      findUnique: vi.fn(async ({ where }: any) => users.get(key(where.phone_role.phone, where.phone_role.role)) ?? null),
      update: vi.fn(async ({ where, data }: any) => {
        const k = key(where.phone_role.phone, where.phone_role.role);
        const updated = { ...users.get(k), ...data };
        users.set(k, updated);
        return updated;
      }),
    },
  } as unknown as PrismaClient;
}

const PHONE = "+2348012345678";

describe("staff auth service (vendor/rider/admin) — US-V-01 / US-R-01", () => {
  let redis: Redis;
  let termii: TermiiClient;
  let prisma: PrismaClient;

  beforeEach(() => {
    redis = createFakeRedis();
    termii = createFakeTermii();
    prisma = createFakePrisma();
  });

  function service(termiiOverride?: TermiiClient, devAutoSigninPhones = "") {
    return createAuthService({
      prisma,
      redis,
      termii: termiiOverride ?? termii,
      jwtAccessSecret: "test-secret-at-least-32-characters-long",
      jwtRefreshSecret: "test-secret-at-least-32-characters-long-2",
      devAutoSigninPhones,
    });
  }

  it("issues a session on a correct code", async () => {
    const svc = service();
    await svc.requestOtp(PHONE);

    const result = await svc.verifyOtp(PHONE, "123456", "vendor");

    expect(result.user.phone).toBe(PHONE);
    expect(result.accessToken).toEqual(expect.any(String));
    expect(result.refreshToken).toEqual(expect.any(String));
  });

  it("rejects a wrong code without issuing a session", async () => {
    const badTermii = createFakeTermii({ verifyOtp: vi.fn().mockResolvedValue({ verified: false }) });
    const svc = service(badTermii);
    await svc.requestOtp(PHONE);

    await expect(svc.verifyOtp(PHONE, "000000", "vendor")).rejects.toThrow(OtpInvalidError);
  });

  it("rejects verification when no code was ever requested", async () => {
    const svc = service();
    await expect(svc.verifyOtp(PHONE, "123456", "vendor")).rejects.toThrow(OtpInvalidError);
  });

  it("locks the number after 5 failed attempts within the window", async () => {
    const badTermii = createFakeTermii({ verifyOtp: vi.fn().mockResolvedValue({ verified: false }) });
    const svc = service(badTermii);
    await svc.requestOtp(PHONE);

    for (let i = 0; i < 5; i++) {
      await expect(svc.verifyOtp(PHONE, "000000", "vendor")).rejects.toThrow(OtpInvalidError);
    }

    // Locked out now — the lockout blocks even requesting a fresh code,
    // not just verifying one, so there is no way to route around it.
    await expect(svc.requestOtp(PHONE)).rejects.toThrow(OtpLockedError);
    await expect(svc.verifyOtp(PHONE, "123456", "vendor")).rejects.toThrow(OtpLockedError);
  });

  it("clears the attempt counter on a successful verification", async () => {
    const flakyTermii = createFakeTermii({
      verifyOtp: vi
        .fn()
        .mockResolvedValueOnce({ verified: false })
        .mockResolvedValueOnce({ verified: false })
        .mockResolvedValueOnce({ verified: true }),
    });
    const svc = service(flakyTermii);
    await svc.requestOtp(PHONE);

    await expect(svc.verifyOtp(PHONE, "111111", "vendor")).rejects.toThrow(OtpInvalidError);
    await svc.requestOtp(PHONE);
    await expect(svc.verifyOtp(PHONE, "222222", "vendor")).rejects.toThrow(OtpInvalidError);
    await svc.requestOtp(PHONE);

    const result = await svc.verifyOtp(PHONE, "333333", "vendor");
    expect(result.user.phone).toBe(PHONE);
  });

  it("the same phone number holds independent vendor and rider accounts (unique per (phone, role), not globally)", async () => {
    const svc = service();
    await svc.requestOtp(PHONE);
    const vendorResult = await svc.verifyOtp(PHONE, "123456", "vendor");
    await svc.requestOtp(PHONE);
    const riderResult = await svc.verifyOtp(PHONE, "123456", "rider");

    expect(vendorResult.user.role).toBe("vendor");
    expect(riderResult.user.role).toBe("rider");
    expect(vendorResult.user.id).not.toBe(riderResult.user.id);
  });
});

describe("admin provisioning is never self-service", () => {
  function service(prisma: PrismaClient, termiiOverride?: TermiiClient, devAutoSigninPhones = "") {
    return createAuthService({
      prisma,
      redis: createFakeRedis(),
      termii: termiiOverride ?? createFakeTermii(),
      jwtAccessSecret: "test-secret-at-least-32-characters-long",
      jwtRefreshSecret: "test-secret-at-least-32-characters-long-2",
      devAutoSigninPhones,
    });
  }

  it("a fresh phone number cannot mint itself an admin session by just claiming role: admin", async () => {
    const prisma = createFakePrisma(); // no admin row provisioned for this phone
    const svc = service(prisma);
    await svc.requestOtp(PHONE);

    await expect(svc.verifyOtp(PHONE, "123456", "admin")).rejects.toThrow(OtpInvalidError);
  });

  it("an already-provisioned admin phone can still log in, and it's a login not a create", async () => {
    const prisma = createFakePrisma({ phone: PHONE });
    const svc = service(prisma);
    await svc.requestOtp(PHONE);

    const result = await svc.verifyOtp(PHONE, "123456", "admin");

    expect(result.user.id).toBe("admin_1");
    expect(result.user.role).toBe("admin");
    expect((prisma.user as any).upsert).not.toHaveBeenCalled();
  });
});

describe("dev auto-signin (DEV_AUTO_SIGNIN_PHONES) — requestOtp's fast path", () => {
  function service(prisma: PrismaClient, devAutoSigninPhones: string) {
    return createAuthService({
      prisma,
      redis: createFakeRedis(),
      termii: createFakeTermii(),
      jwtAccessSecret: "test-secret-at-least-32-characters-long",
      jwtRefreshSecret: "test-secret-at-least-32-characters-long-2",
      devAutoSigninPhones,
    });
  }

  it("mints a real session with zero OTP round-trip for an allowlisted vendor/rider phone", async () => {
    const prisma = createFakePrisma();
    const svc = service(prisma, PHONE);

    const result = await svc.tryAutoSignin(PHONE, "vendor");

    expect(result).not.toBeNull();
    expect(result!.user.role).toBe("vendor");
    expect(result!.accessToken).toEqual(expect.any(String));
  });

  it("returns null for a phone not on the allowlist — falls through to the normal OTP flow", async () => {
    const prisma = createFakePrisma();
    const svc = service(prisma, "+2340000000000"); // a different number

    const result = await svc.tryAutoSignin(PHONE, "vendor");
    expect(result).toBeNull();
  });

  it("never mints an admin session for an allowlisted phone with no admin row provisioned", async () => {
    const prisma = createFakePrisma(); // no admin row
    const svc = service(prisma, PHONE);

    const result = await svc.tryAutoSignin(PHONE, "admin");
    expect(result).toBeNull();
  });

  it("does mint an admin session for an allowlisted phone that already has an admin row", async () => {
    const prisma = createFakePrisma({ phone: PHONE });
    const svc = service(prisma, PHONE);

    const result = await svc.tryAutoSignin(PHONE, "admin");
    expect(result).not.toBeNull();
    expect(result!.user.role).toBe("admin");
  });

  it("empty allowlist (the real default) never activates for anyone", async () => {
    const prisma = createFakePrisma();
    const svc = service(prisma, "");

    const result = await svc.tryAutoSignin(PHONE, "vendor");
    expect(result).toBeNull();
  });
});
