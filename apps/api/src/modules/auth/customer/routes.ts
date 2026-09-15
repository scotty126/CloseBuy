import type { FastifyInstance } from "fastify";
import * as client from "openid-client";
import {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from "@closebuy/types";
import {
  createCustomerAuthService,
  EmailAlreadyRegisteredError,
  InvalidCredentialsError,
  LoginLockedError,
  InvalidResetTokenError,
} from "./service.js";
import { createEmailClient } from "./email.js";
import { getGoogleConfig, getAppleConfig } from "./oauth.js";
import { serializeUser } from "../../../lib/serialize-user.js";

const OAUTH_STATE_TTL_SECONDS = 10 * 60;

/** Customer — email/password or Google/Apple (brief §3.1b). Vendor/rider/admin auth lives in ../routes.js instead. */
export async function customerAuthRoutes(app: FastifyInstance) {
  const email = createEmailClient(app.env.RESEND_API_KEY);
  const appBaseUrl = app.env.CUSTOMER_APP_URL;

  const authService = createCustomerAuthService({
    prisma: app.prisma,
    redis: app.redis,
    email,
    jwtAccessSecret: app.env.JWT_ACCESS_SECRET,
    jwtRefreshSecret: app.env.JWT_REFRESH_SECRET,
    passwordPepper: app.env.PASSWORD_PEPPER,
    appBaseUrl,
  });

  app.post("/auth/register", async (req, reply) => {
    const body = registerSchema.parse(req.body);
    try {
      const { user, accessToken, refreshToken } = await authService.register(body.email, body.password);
      return reply.send({ accessToken, refreshToken, user: serializeUser(user) });
    } catch (err) {
      if (err instanceof EmailAlreadyRegisteredError) {
        return reply.code(409).send({ error: { code: "EMAIL_TAKEN", message: err.message } });
      }
      throw err;
    }
  });

  app.post("/auth/login", async (req, reply) => {
    const body = loginSchema.parse(req.body);
    try {
      const { user, accessToken, refreshToken } = await authService.login(body.email, body.password);
      return reply.send({ accessToken, refreshToken, user: serializeUser(user) });
    } catch (err) {
      if (err instanceof LoginLockedError) {
        return reply.code(429).send({ error: { code: "LOGIN_LOCKED", message: err.message } });
      }
      if (err instanceof InvalidCredentialsError) {
        return reply.code(401).send({ error: { code: "INVALID_CREDENTIALS", message: err.message } });
      }
      throw err;
    }
  });

  app.post("/auth/forgot-password", async (req, reply) => {
    const body = forgotPasswordSchema.parse(req.body);
    await authService.requestPasswordReset(body.email);
    return reply.code(204).send(); // always 204 — never reveals whether the email exists
  });

  app.post("/auth/reset-password", async (req, reply) => {
    const body = resetPasswordSchema.parse(req.body);
    try {
      await authService.resetPassword(body.token, body.newPassword);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof InvalidResetTokenError) {
        return reply.code(400).send({ error: { code: "RESET_TOKEN_INVALID", message: err.message } });
      }
      throw err;
    }
  });

  app.post("/auth/verify-email", async (req, reply) => {
    const { token } = req.body as { token: string };
    const verified = await authService.verifyEmail(token);
    return reply.send({ verified });
  });

  // ── Google ────────────────────────────────────────────────────────────

  app.get("/auth/oauth/google", async (_req, reply) => {
    const config = await getGoogleConfig(app.env.GOOGLE_OAUTH_CLIENT_ID, app.env.GOOGLE_OAUTH_CLIENT_SECRET);
    if (!config) {
      return reply
        .code(503)
        .send({ error: { code: "OAUTH_NOT_CONFIGURED", message: "Google sign-in isn't set up yet." } });
    }

    const codeVerifier = client.randomPKCECodeVerifier();
    const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
    const state = client.randomState();
    // Redis, not a cookie — keeps this endpoint stateless like the rest of
    // the API; Google echoes `state` back on the callback, which is enough
    // to look the verifier back up.
    await app.redis.set(`oauth:google:${state}`, codeVerifier, "EX", OAUTH_STATE_TTL_SECONDS);

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

    const codeVerifier = await app.redis.get(`oauth:google:${state}`);
    if (!codeVerifier) return reply.code(400).send({ error: { code: "OAUTH_STATE_EXPIRED", message: "Sign-in expired, try again." } });
    await app.redis.del(`oauth:google:${state}`);

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

      const { accessToken, refreshToken } = await authService.findOrCreateFromOAuth(
        "google",
        claims.sub,
        claims.email as string,
      );

      // Hands the session to the SPA via a one-time URL fragment rather
      // than a body — this is a browser redirect landing, not an API call
      // the client made directly, so there's no JSON response to return
      // it in. A fragment (not a query param) so the tokens never hit
      // server logs or the Referer header.
      const redirectTo = new URL(`${appBaseUrl}/oauth-complete`);
      redirectTo.hash = `accessToken=${accessToken}&refreshToken=${refreshToken}`;
      return reply.redirect(redirectTo.toString());
    } catch (err) {
      if (err instanceof client.ClientError) {
        req.log.warn({ err }, "Google OAuth callback failed");
        return reply.code(400).send({ error: { code: "OAUTH_FAILED", message: "Google sign-in failed." } });
      }
      throw err;
    }
  });

  // ── Apple ─────────────────────────────────────────────────────────────
  // Structurally the same shape as Google. Genuinely untestable without a
  // paid Apple Developer account (.env.example) — getAppleConfig() returns
  // null and this 503s exactly like Google's does without credentials.
  // oauth.ts flags the one piece (PrivateKeyJwt client auth) not worth
  // building further until there's something to actually run it against.

  app.get("/auth/oauth/apple", async (_req, reply) => {
    const config = await getAppleConfig(
      app.env.APPLE_OAUTH_CLIENT_ID,
      app.env.APPLE_OAUTH_TEAM_ID,
      app.env.APPLE_OAUTH_KEY_ID,
      app.env.APPLE_OAUTH_PRIVATE_KEY,
    );
    if (!config) {
      return reply
        .code(503)
        .send({ error: { code: "OAUTH_NOT_CONFIGURED", message: "Apple sign-in isn't set up yet." } });
    }

    const state = client.randomState();
    await app.redis.set(`oauth:apple:${state}`, "1", "EX", OAUTH_STATE_TTL_SECONDS);

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
    if (!state || !(await app.redis.get(`oauth:apple:${state}`))) {
      return reply.code(400).send({ error: { code: "OAUTH_STATE_EXPIRED", message: "Sign-in expired, try again." } });
    }
    await app.redis.del(`oauth:apple:${state}`);

    try {
      // Apple's response_mode=form_post delivers the callback as a POSTed
      // body, not query params — reconstruct the URL authorizationCodeGrant
      // expects from that body instead of req.url.
      const params = new URLSearchParams(req.body as Record<string, string>);
      const currentUrl = new URL(`${app.env.API_PUBLIC_URL}/auth/oauth/apple/callback?${params.toString()}`);

      const tokens = await client.authorizationCodeGrant(config, currentUrl, { expectedState: state });
      const claims = tokens.claims();
      if (!claims?.email) {
        return reply.code(400).send({ error: { code: "OAUTH_NO_EMAIL", message: "Apple didn't return an email address." } });
      }

      const { accessToken, refreshToken } = await authService.findOrCreateFromOAuth(
        "apple",
        claims.sub,
        claims.email as string,
      );

      const redirectTo = new URL(`${appBaseUrl}/oauth-complete`);
      redirectTo.hash = `accessToken=${accessToken}&refreshToken=${refreshToken}`;
      return reply.redirect(redirectTo.toString());
    } catch (err) {
      if (err instanceof client.ClientError) {
        req.log.warn({ err }, "Apple OAuth callback failed");
        return reply.code(400).send({ error: { code: "OAUTH_FAILED", message: "Apple sign-in failed." } });
      }
      throw err;
    }
  });
}
