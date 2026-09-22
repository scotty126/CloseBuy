import type { FastifyInstance, FastifyReply } from "fastify";
import * as client from "openid-client";
import type { UserRole } from "@prisma/client";
import { getGoogleConfig, getAppleConfig } from "./customer/oauth.js";
import { createOAuthAccountService, OAuthAdminNotProvisionedError, OAuthEmailRoleMismatchError } from "./oauth-account.js";

const OAUTH_STATE_TTL_SECONDS = 10 * 60;
const OAUTH_ROLES = ["customer", "vendor", "rider", "admin"] as const;

function isOAuthRole(value: unknown): value is UserRole {
  return typeof value === "string" && (OAUTH_ROLES as readonly string[]).includes(value);
}

/**
 * Google/Apple sign-in, shared by all four apps — one registration
 * instead of one per role, since oauth.ts's discovery/PKCE plumbing was
 * already fully generic (just needed callers to stop assuming "customer"
 * everywhere). `role` travels as a query param on the initial /auth/oauth/*
 * request (each app's OAuthButtons links to its own role — see each
 * app's lib/api.ts) and rides along through Redis-backed `state` (Google)
 * or the Apple `state` token to the callback, so the callback knows which
 * app to redirect back to and which role to create/require — never trusts
 * a client-supplied redirect URL directly (open-redirect risk), only ever
 * looks one up from env.ts's fixed per-app URLs.
 */
export async function oauthRoutes(app: FastifyInstance) {
  const oauthAccounts = createOAuthAccountService({
    prisma: app.prisma,
    jwtAccessSecret: app.env.JWT_ACCESS_SECRET,
    jwtRefreshSecret: app.env.JWT_REFRESH_SECRET,
  });

  const appUrlForRole: Record<UserRole, string> = {
    customer: app.env.CUSTOMER_APP_URL,
    vendor: app.env.VENDOR_APP_URL,
    rider: app.env.RIDER_APP_URL,
    admin: app.env.ADMIN_APP_URL,
  };

  function handleOAuthError(reply: FastifyReply, err: unknown) {
    if (err instanceof OAuthAdminNotProvisionedError) {
      return reply.code(403).send({ error: { code: "OAUTH_ADMIN_NOT_PROVISIONED", message: err.message } });
    }
    if (err instanceof OAuthEmailRoleMismatchError) {
      return reply.code(409).send({ error: { code: "OAUTH_ROLE_MISMATCH", message: err.message } });
    }
    if (err instanceof client.ClientError) {
      return reply.code(400).send({ error: { code: "OAUTH_FAILED", message: "Sign-in failed." } });
    }
    throw err;
  }

  // ── Google ────────────────────────────────────────────────────────────

  app.get("/auth/oauth/google", async (req, reply) => {
    const config = await getGoogleConfig(app.env.GOOGLE_OAUTH_CLIENT_ID, app.env.GOOGLE_OAUTH_CLIENT_SECRET);
    if (!config) {
      return reply.code(503).send({ error: { code: "OAUTH_NOT_CONFIGURED", message: "Google sign-in isn't set up yet." } });
    }

    const { role: rawRole } = req.query as { role?: string };
    const role: UserRole = isOAuthRole(rawRole) ? rawRole : "customer";

    const codeVerifier = client.randomPKCECodeVerifier();
    const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
    const state = client.randomState();
    await app.redis.set(`oauth:google:${state}`, JSON.stringify({ codeVerifier, role }), "EX", OAUTH_STATE_TTL_SECONDS);

    const redirectTo = client.buildAuthorizationUrl(config, {
      redirect_uri: `${app.env.API_PUBLIC_URL}/auth/oauth/google/callback`,
      scope: "openid email",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state,
    });
    return reply.redirect(redirectTo.href);
  });

  app.get("/auth/oauth/google/callback", async (req, reply) => {
    const config = await getGoogleConfig(app.env.GOOGLE_OAUTH_CLIENT_ID, app.env.GOOGLE_OAUTH_CLIENT_SECRET);
    if (!config) {
      return reply.code(503).send({ error: { code: "OAUTH_NOT_CONFIGURED", message: "Google sign-in isn't set up." } });
    }

    const { state } = req.query as { state?: string };
    if (!state) return reply.code(400).send({ error: { code: "OAUTH_INVALID", message: "Missing state." } });

    const stored = await app.redis.get(`oauth:google:${state}`);
    if (!stored) return reply.code(400).send({ error: { code: "OAUTH_STATE_EXPIRED", message: "Sign-in expired, try again." } });
    await app.redis.del(`oauth:google:${state}`);
    const { codeVerifier, role } = JSON.parse(stored) as { codeVerifier: string; role: UserRole };

    try {
      const currentUrl = new URL(req.url, app.env.API_PUBLIC_URL);
      const tokens = await client.authorizationCodeGrant(config, currentUrl, {
        pkceCodeVerifier: codeVerifier,
        expectedState: state,
      });
      const claims = tokens.claims();
      if (!claims?.email) {
        return reply.code(400).send({ error: { code: "OAUTH_NO_EMAIL", message: "Google didn't return an email address." } });
      }

      const { accessToken, refreshToken } = await oauthAccounts.findOrCreateFromOAuth(
        "google",
        claims.sub,
        claims.email as string,
        role,
      );
      return redirectWithSession(reply, appUrlForRole[role], accessToken, refreshToken);
    } catch (err) {
      req.log.warn({ err }, "Google OAuth callback failed");
      return handleOAuthError(reply, err);
    }
  });

  // ── Apple ─────────────────────────────────────────────────────────────
  // Structurally the same shape as Google. Genuinely untestable without a
  // paid Apple Developer account (.env.example) — getAppleConfig() returns
  // null and this 503s exactly like Google's does without credentials.

  app.get("/auth/oauth/apple", async (req, reply) => {
    const config = await getAppleConfig(
      app.env.APPLE_OAUTH_CLIENT_ID,
      app.env.APPLE_OAUTH_TEAM_ID,
      app.env.APPLE_OAUTH_KEY_ID,
      app.env.APPLE_OAUTH_PRIVATE_KEY,
    );
    if (!config) {
      return reply.code(503).send({ error: { code: "OAUTH_NOT_CONFIGURED", message: "Apple sign-in isn't set up yet." } });
    }

    const { role: rawRole } = req.query as { role?: string };
    const role: UserRole = isOAuthRole(rawRole) ? rawRole : "customer";

    const state = client.randomState();
    await app.redis.set(`oauth:apple:${state}`, role, "EX", OAUTH_STATE_TTL_SECONDS);

    const redirectTo = client.buildAuthorizationUrl(config, {
      redirect_uri: `${app.env.API_PUBLIC_URL}/auth/oauth/apple/callback`,
      scope: "email",
      response_mode: "form_post",
      state,
    });
    return reply.redirect(redirectTo.href);
  });

  app.post("/auth/oauth/apple/callback", async (req, reply) => {
    const config = await getAppleConfig(
      app.env.APPLE_OAUTH_CLIENT_ID,
      app.env.APPLE_OAUTH_TEAM_ID,
      app.env.APPLE_OAUTH_KEY_ID,
      app.env.APPLE_OAUTH_PRIVATE_KEY,
    );
    if (!config) return reply.code(503).send({ error: { code: "OAUTH_NOT_CONFIGURED", message: "Apple sign-in isn't set up." } });

    const { state } = req.body as { state?: string };
    const storedRole = state ? await app.redis.get(`oauth:apple:${state}`) : null;
    if (!state || !storedRole) {
      return reply.code(400).send({ error: { code: "OAUTH_STATE_EXPIRED", message: "Sign-in expired, try again." } });
    }
    await app.redis.del(`oauth:apple:${state}`);
    const role = isOAuthRole(storedRole) ? storedRole : "customer";

    try {
      const params = new URLSearchParams(req.body as Record<string, string>);
      const currentUrl = new URL(`${app.env.API_PUBLIC_URL}/auth/oauth/apple/callback?${params.toString()}`);

      const tokens = await client.authorizationCodeGrant(config, currentUrl, { expectedState: state });
      const claims = tokens.claims();
      if (!claims?.email) {
        return reply.code(400).send({ error: { code: "OAUTH_NO_EMAIL", message: "Apple didn't return an email address." } });
      }

      const { accessToken, refreshToken } = await oauthAccounts.findOrCreateFromOAuth(
        "apple",
        claims.sub,
        claims.email as string,
        role,
      );
      return redirectWithSession(reply, appUrlForRole[role], accessToken, refreshToken);
    } catch (err) {
      req.log.warn({ err }, "Apple OAuth callback failed");
      return handleOAuthError(reply, err);
    }
  });
}

// Hands the session to the SPA via a one-time URL fragment rather than a
// body — this is a browser redirect landing, not an API call the client
// made directly, so there's no JSON response to return it in. A fragment
// (not a query param) so the tokens never hit server logs or the Referer
// header. No serialized user attached — /auth/me (shared across roles)
// hydrates the full user object client-side right after landing.
function redirectWithSession(reply: FastifyReply, appBaseUrl: string, accessToken: string, refreshToken: string) {
  const redirectTo = new URL(`${appBaseUrl}/oauth-complete`);
  redirectTo.hash = `accessToken=${accessToken}&refreshToken=${refreshToken}`;
  return reply.redirect(redirectTo.toString());
}
