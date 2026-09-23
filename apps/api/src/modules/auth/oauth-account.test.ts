import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createOAuthAccountService, OAuthAdminNotProvisionedError } from "./oauth-account.js";

// Keyed by (email, role) and (provider, providerAccountId, role) — schema.prisma's
// real composite uniques, now that the same email/Google account can hold
// a customer row AND a vendor row AND a rider row AND an admin row at once.
function createFakePrisma(seedUsers: Array<{ email: string; role: string }> = []): PrismaClient {
  const usersByKey = new Map<string, any>(); // key: `${email}:${role}`
  const userKey = (email: string, role: string) => `${email}:${role}`;
  for (const u of seedUsers) usersByKey.set(userKey(u.email, u.role), { id: `seed_${u.email}_${u.role}`, ...u });
  const links = new Map<string, any>(); // key: `${provider}:${providerAccountId}:${role}`
  const linkKey = (provider: string, providerAccountId: string, role: string) => `${provider}:${providerAccountId}:${role}`;

  return {
    user: {
      findUnique: vi.fn(async ({ where }: any) => usersByKey.get(userKey(where.email_role.email, where.email_role.role)) ?? null),
      upsert: vi.fn(async ({ where, update, create }: any) => {
        const k = userKey(where.email_role.email, where.email_role.role);
        const existing = usersByKey.get(k);
        const row = existing ? { ...existing, ...update } : { id: `user_${usersByKey.size + 1}`, ...create };
        usersByKey.set(k, row);
        return row;
      }),
    },
    oAuthAccount: {
      findUnique: vi.fn(async ({ where }: any) => {
        const { provider, providerAccountId, role } = where.provider_providerAccountId_role;
        const link = links.get(linkKey(provider, providerAccountId, role));
        if (!link) return null;
        return { ...link, user: usersByKey.get(userKey(link.email, link.role)) };
      }),
      create: vi.fn(async ({ data }: any) => {
        const user = [...usersByKey.values()].find((u) => u.id === data.userId);
        links.set(linkKey(data.provider, data.providerAccountId, data.role), { ...data, email: user.email });
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

  it("links a second Google sign-in for the same email+role to the same account, not a new one", async () => {
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

  it("the same Google account independently becomes a customer account AND a vendor account (unique per (provider, providerAccountId, role), not globally)", async () => {
    const prisma = createFakePrisma();
    const svc = createOAuthAccountService({ prisma, ...DEPS_BASE });

    const customerResult = await svc.findOrCreateFromOAuth("google", "google-sub-1", "same@example.com", "customer");
    const vendorResult = await svc.findOrCreateFromOAuth("google", "google-sub-1", "same@example.com", "vendor");

    expect(customerResult.user.role).toBe("customer");
    expect(vendorResult.user.role).toBe("vendor");
    expect(customerResult.user.id).not.toBe(vendorResult.user.id);
  });
});
