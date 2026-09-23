import type { PrismaClient, User, UserRole } from "@prisma/client";
import { signAccessToken, signRefreshToken } from "../../lib/jwt.js";

export class OAuthAdminNotProvisionedError extends Error {
  constructor() {
    super("This Google/Apple account isn't linked to an admin. Ask an existing admin to set one up.");
  }
}

export interface OAuthAccountDeps {
  prisma: PrismaClient;
  jwtAccessSecret: string;
  jwtRefreshSecret: string;
}

/**
 * Google/Apple sign-in, any role — brief §3.1b originally scoped OAuth to
 * customer only; relaxed the same way phone/OTP (service.ts) and
 * email/password (email.ts) were, and for the same reason (Termii being
 * blocked shouldn't be the only door into the app). `email` and
 * `OAuthAccount`'s (provider, providerAccountId) are both unique per role
 * now (schema.prisma), not globally — the same real Google/Apple account
 * can independently become a customer row AND a vendor row AND a rider
 * row AND an admin row. Every lookup below is keyed on the composite
 * (…, role), which is also why a cross-role mismatch simply can't occur
 * here anymore: the query for "this account, this role" either finds
 * that exact row or finds nothing, never a different role's row.
 *
 * Admin is the one exception, matching findOrCreateStaffUser (service.ts)
 * and AdminSelfRegistrationDisabledError (email.ts): a fresh Google/Apple
 * identity proves control of an inbox, not admin authority, so this never
 * creates an admin row — only links Google/Apple to one that already
 * exists.
 */
export function createOAuthAccountService(deps: OAuthAccountDeps) {
  function issueSession(user: User) {
    return {
      accessToken: signAccessToken(user.id, user.role, deps.jwtAccessSecret),
      refreshToken: signRefreshToken(user.id, deps.jwtRefreshSecret),
    };
  }

  return {
    async findOrCreateFromOAuth(provider: "google" | "apple", providerAccountId: string, email: string, role: UserRole) {
      const existingLink = await deps.prisma.oAuthAccount.findUnique({
        where: { provider_providerAccountId_role: { provider, providerAccountId, role } },
        include: { user: true },
      });
      if (existingLink) return { user: existingLink.user, ...issueSession(existingLink.user) };

      if (role === "admin") {
        const existingAdmin = await deps.prisma.user.findUnique({ where: { email_role: { email, role: "admin" } } });
        if (!existingAdmin) throw new OAuthAdminNotProvisionedError();

        await deps.prisma.oAuthAccount.create({ data: { userId: existingAdmin.id, provider, providerAccountId, role } });
        return { user: existingAdmin, ...issueSession(existingAdmin) };
      }

      const user = await deps.prisma.user.upsert({
        where: { email_role: { email, role } },
        update: {}, // account already exists for this (email, role) — just link, below
        create: {
          email,
          role,
          emailVerifiedAt: new Date(),
          ...(role === "customer" ? { customerProfile: { create: {} } } : {}),
        },
      });

      await deps.prisma.oAuthAccount.create({ data: { userId: user.id, provider, providerAccountId, role } });
      return { user, ...issueSession(user) };
    },
  };
}

export type OAuthAccountService = ReturnType<typeof createOAuthAccountService>;
