import type { PrismaClient, User, UserRole } from "@prisma/client";
import { signAccessToken, signRefreshToken } from "../../lib/jwt.js";

export class OAuthAdminNotProvisionedError extends Error {
  constructor() {
    super("This Google/Apple account isn't linked to an admin. Ask an existing admin to set one up.");
  }
}

export class OAuthEmailRoleMismatchError extends Error {
  constructor() {
    super("This email is already registered under a different account type.");
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
 * blocked shouldn't be the only door into the app). Links to an existing
 * account by verified email if one already exists (so someone who
 * registered with a password and later taps "Continue with Google" on the
 * same address gets one account, not two) — otherwise creates a fresh
 * one. `email` is still globally unique (schema.prisma), so one email is
 * one account regardless of how it signs in.
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
        where: { provider_providerAccountId: { provider, providerAccountId } },
        include: { user: true },
      });
      if (existingLink) {
        if (existingLink.user.role !== role) throw new OAuthEmailRoleMismatchError();
        return { user: existingLink.user, ...issueSession(existingLink.user) };
      }

      if (role === "admin") {
        const existingAdmin = await deps.prisma.user.findUnique({ where: { email } });
        if (!existingAdmin || existingAdmin.role !== "admin") {
          throw new OAuthAdminNotProvisionedError();
        }
        await deps.prisma.oAuthAccount.create({ data: { userId: existingAdmin.id, provider, providerAccountId } });
        return { user: existingAdmin, ...issueSession(existingAdmin) };
      }

      const user = await deps.prisma.user.upsert({
        where: { email },
        update: {}, // account already exists (password or another provider) — just link, below
        create: {
          email,
          role,
          emailVerifiedAt: new Date(),
          ...(role === "customer" ? { customerProfile: { create: {} } } : {}),
        },
      });
      // The upsert's `update` branch leaves an existing row's role exactly
      // as it was — if that role isn't the one this sign-in asked for
      // (e.g. this is a vendor-app Google button hitting an email that's
      // actually a customer account), fail rather than silently issuing a
      // session for the wrong role.
      if (user.role !== role) throw new OAuthEmailRoleMismatchError();

      await deps.prisma.oAuthAccount.create({ data: { userId: user.id, provider, providerAccountId } });
      return { user, ...issueSession(user) };
    },
  };
}

export type OAuthAccountService = ReturnType<typeof createOAuthAccountService>;
