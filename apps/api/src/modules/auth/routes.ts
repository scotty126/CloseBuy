import type { FastifyInstance } from "fastify";
import { otpRequestSchema, otpVerifySchema, refreshRequestSchema } from "@closebuy/types";
import { createAuthService, OtpInvalidError, OtpLockedError } from "./service.js";
import { createTermiiClient } from "./termii.js";
import { verifyRefreshToken, signAccessToken } from "../../lib/jwt.js";

export async function authRoutes(app: FastifyInstance) {
  const termii = createTermiiClient(app.env.TERMII_API_KEY, app.env.TERMII_SENDER_ID);
  const authService = createAuthService({
    prisma: app.prisma,
    redis: app.redis,
    termii,
    jwtAccessSecret: app.env.JWT_ACCESS_SECRET,
    jwtRefreshSecret: app.env.JWT_REFRESH_SECRET,
  });

  // Registered separately (not globally) so this specific endpoint gets a
  // tighter limit than the app default — this IS the resource US-C-01's
  // 5-attempts/15-min rule protects, so the HTTP layer should throttle it
  // too, not just the application-level counter in the service.
  app.register(async (scoped) => {
    await scoped.register(import("@fastify/rate-limit"), {
      max: 5,
      timeWindow: "15 minutes",
    });

    scoped.post("/auth/otp/request", async (req, reply) => {
      const body = otpRequestSchema.parse(req.body);
      await authService.requestOtp(body.phone);
      return reply.code(204).send();
    });
  });

  app.post("/auth/otp/verify", async (req, reply) => {
    const body = otpVerifySchema.parse(req.body);

    try {
      const { user, accessToken, refreshToken } = await authService.verifyOtp(
        body.phone,
        body.code,
        body.role,
      );
      return reply.send({
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          phone: user.phone,
          role: user.role,
          phoneVerifiedAt: user.phoneVerifiedAt?.toISOString(),
        },
      });
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
}
