import type { FastifyInstance } from "fastify";
import { otpRequestSchema, otpVerifySchema, refreshRequestSchema, staffRegisterSchema, staffLoginSchema } from "@closebuy/types";
import type { OtpRequestResponse } from "@closebuy/types";
import { createAuthService, OtpInvalidError, OtpLockedError } from "./service.js";
import {
  createStaffEmailAuthService,
  EmailAlreadyRegisteredError,
  InvalidCredentialsError,
  LoginLockedError,
  AdminSelfRegistrationDisabledError,
} from "./email.js";
import { createTermiiClient, createDevOtpClient } from "./termii.js";
import { verifyRefreshToken, signAccessToken } from "../../lib/jwt.js";
import { serializeUser } from "../../lib/serialize-user.js";

/**
 * Vendor / rider / admin — phone+OTP and email/password (brief §3.1b,
 * relaxed to add email/password as a second option once Termii turned
 * out to be a real, months-long bottleneck — see email.js for why the
 * admin-provisioning safeguard applies there exactly like it does below).
 * Google/Apple for every role lives in ./oauth-routes.js. Customer auth
 * lives in ./customer/routes.js instead.
 */
export async function staffAuthRoutes(app: FastifyInstance) {
  const termiiConfigured = Boolean(app.env.TERMII_API_KEY && app.env.TERMII_SENDER_ID);
  const otpUnavailable = !termiiConfigured && !app.env.OTP_DEV_FALLBACK;
  const termii = termiiConfigured
    ? createTermiiClient(app.env.TERMII_API_KEY, app.env.TERMII_SENDER_ID)
    : createDevOtpClient();
  const authService = createAuthService({
    prisma: app.prisma,
    redis: app.redis,
    termii,
    jwtAccessSecret: app.env.JWT_ACCESS_SECRET,
    jwtRefreshSecret: app.env.JWT_REFRESH_SECRET,
    devAutoSigninPhones: app.env.DEV_AUTO_SIGNIN_PHONES,
  });
  const staffEmailAuth = createStaffEmailAuthService({
    prisma: app.prisma,
    redis: app.redis,
    jwtAccessSecret: app.env.JWT_ACCESS_SECRET,
    jwtRefreshSecret: app.env.JWT_REFRESH_SECRET,
    passwordPepper: app.env.PASSWORD_PEPPER,
  });

  // Registered separately (not globally) so this specific endpoint gets a
  // tighter limit than the app default — this IS the resource US-V-01/
  // US-R-01's 5-attempts/15-min rule protects, so the HTTP layer should
  // throttle it too, not just the application-level counter in the service.
  app.register(async (scoped) => {
    await scoped.register(import("@fastify/rate-limit"), {
      max: 5,
      timeWindow: "15 minutes",
    });

    scoped.post("/auth/otp/request", async (req, reply) => {
      const body = otpRequestSchema.parse(req.body);

      // Checked before the otpUnavailable gate below, deliberately — this
      // is exactly the "Termii isn't configured" situation
      // DEV_AUTO_SIGNIN_PHONES exists for, so it must not be blocked by it.
      const auto = await authService.tryAutoSignin(body.phone, body.role);
      if (auto) {
        const body: OtpRequestResponse = {
          session: { accessToken: auto.accessToken, refreshToken: auto.refreshToken, user: serializeUser(auto.user) },
        };
        return reply.send(body);
      }

      if (otpUnavailable) {
        return reply
          .code(503)
          .send({ error: { code: "TERMII_NOT_CONFIGURED", message: "OTP sign-in isn't set up yet." } });
      }
      const { devCode } = await authService.requestOtp(body.phone);
      // devCode is only ever set by the dev fallback (termii.ts,
      // OTP_DEV_FALLBACK) — a real Termii send never returns one, so this
      // never appears once real credentials are configured.
      if (devCode) return reply.code(200).send({ devCode } satisfies OtpRequestResponse);
      return reply.code(204).send();
    });
  });

  app.post("/auth/otp/verify", async (req, reply) => {
    if (otpUnavailable) {
      return reply
        .code(503)
        .send({ error: { code: "TERMII_NOT_CONFIGURED", message: "OTP sign-in isn't set up yet." } });
    }
    const body = otpVerifySchema.parse(req.body);

    try {
      const { user, accessToken, refreshToken } = await authService.verifyOtp(
        body.phone,
        body.code,
        body.role,
      );
      return reply.send({ accessToken, refreshToken, user: serializeUser(user) });
    } catch (err) {
      if (err instanceof OtpLockedError) {
        return reply.code(429).send({ error: { code: "OTP_LOCKED", message: err.message } });
      }
      if (err instanceof OtpInvalidError) {
        return reply.code(400).send({ error: { code: "OTP_INVALID", message: err.message } });
      }
      throw err;
    }
  });

  app.post("/auth/refresh", async (req, reply) => {
    const body = refreshRequestSchema.parse(req.body);
    const { sub: userId } = verifyRefreshToken(body.refreshToken, app.env.JWT_REFRESH_SECRET);

    const user = await app.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const accessToken = signAccessToken(user.id, user.role, app.env.JWT_ACCESS_SECRET);

    return reply.send({ accessToken });
  });

  // ── Email/password — the alternative to phone+OTP above (email.js) ─────

  app.post("/auth/staff/register", async (req, reply) => {
    const body = staffRegisterSchema.parse(req.body);
    try {
      const { user, accessToken, refreshToken } = await staffEmailAuth.register(body.email, body.password, body.role);
      return reply.send({ accessToken, refreshToken, user: serializeUser(user) });
    } catch (err) {
      if (err instanceof EmailAlreadyRegisteredError) {
        return reply.code(409).send({ error: { code: "EMAIL_TAKEN", message: err.message } });
      }
      if (err instanceof AdminSelfRegistrationDisabledError) {
        return reply.code(403).send({ error: { code: "ADMIN_SELF_REGISTRATION_DISABLED", message: err.message } });
      }
      throw err;
    }
  });

  app.post("/auth/staff/login", async (req, reply) => {
    const body = staffLoginSchema.parse(req.body);
    try {
      const { user, accessToken, refreshToken } = await staffEmailAuth.login(body.email, body.password, body.role);
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
}
