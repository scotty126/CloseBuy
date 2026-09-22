import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createOAuthAccountService, OAuthAdminNotProvisionedError, OAuthEmailRoleMismatchError } from "./oauth-account.js";

function createFakePrisma(seedUsers: Array<{ email: string; role: string }> = []): PrismaClient {
  const usersByEmail = new Map<string, any>();
  for (const u of seedUsers) usersByEmail.set(u.email, { id: `seed_${u.email}`, ...u });
  const links = new Map<string, any>(); // key: `${provider}:${providerAccountId}`

  return {
    user: {
      findUnique: vi.fn(async ({ where }: any) => usersByEmail.get(where.email) ?? null),
      upsert: vi.fn(async ({ where, update, create }: any) => {
        const existing = usersByEmail.get(where.email);
        const row = existing ? { ...existing, ...update } : { id: `user_${usersByEmail.size + 1}`, ...create };
        usersByEmail.set(where.email, row);
        return row;
      }),
    },
    oAuthAccount: {
      findUnique: vi.fn(async ({ where }: any) => {
        const k = `${where.provider_providerAccountId.provider}:${where.provider_providerAccountId.providerAccountId}`;
        const link = links.get(k);
        if (!link) return null;
        return { ...link, user: usersByEmail.get(link.email) };
      }),
      create: vi.fn(async ({ data }: any) => {
        const user = [...usersByEmail.values()].find((u) => u.id === data.userId);
        links.set(`${data.provider}:${data.providerAccountId}`, { ...data, email: user.email });
        return data;
      }),
    },
  } as unknown as PrismaClient;
}

const DEPS_BASE = {
  jwtAccessSecret: "test-secret-at-least-32-characters-long",
  jwtRefreshSecret: "test-secret-at-least-32-characters-long-2",
};

describe("OAuth account linking — any role", () => {
  it("creates a fresh vendor account and issues a session on first sign-in", async () => {
    const prisma = createFakePrisma();
    const svc = createOAuthAccountService({ prisma, ...DEPS_BASE });

    const result = await svc.findOrCreateFromOAuth("google", "google-sub-1", "vendor@example.com", "vendor");
    expect(result.user.role).toBe("vendor");
    expect(result.accessToken).toEqual(expect.any(String));
  });

  it("links a second Google sign-in for the same email to the same account, not a new one", async () => {
    const prisma = createFakePrisma();
    const svc = createOAuthAccountService({ prisma, ...DEPS_BASE });

    const first = await svc.findOrCreateFromOAuth("google", "google-sub-1", "vendor@example.com", "vendor");
    const second = await svc.findOrCreateFromOAuth("google", "google-sub-1", "vendor@example.com", "vendor");
    expect(second.user.id).toBe(first.user.id);
  });

  it("never creates an admin account — only links Google/Apple to one that already exists", async () => {
    const prisma = createFakePrisma(); // no admin row seeded
    const svc = createOAuthAccountService({ prisma, ...DEPS_BASE });

    await expect(
      svc.findOrCreateFromOAuth("google", "google-sub-1", "someone@example.com", "admin"),
    ).rejects.toThrow(OAuthAdminNotProvisionedError);
  });

  it("links Google to an already-provisioned admin account", async () => {
    const prisma = createFakePrisma([{ email: "admin@example.com", role: "admin" }]);
    const svc = createOAuthAccountService({ prisma, ...DEPS_BASE });

    const result = await svc.findOrCreateFromOAuth("google", "google-sub-1", "admin@example.com", "admin");
    expect(result.user.role).toBe("admin");
  });

  it("rejects when the email already belongs to a different role's account", async () => {
    const prisma = createFakePrisma([{ email: "shared@example.com", role: "customer" }]);
    const svc = createOAuthAccountService({ prisma, ...DEPS_BASE });

    await expect(
      svc.findOrCreateFromOAuth("google", "google-sub-1", "shared@example.com", "vendor"),
    ).rejects.toThrow(OAuthEmailRoleMismatchError);
  });
});
