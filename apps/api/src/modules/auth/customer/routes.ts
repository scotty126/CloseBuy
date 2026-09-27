import type { FastifyInstance } from "fastify";
import {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  customerProfileUpdateSchema,
  addressCreateSchema,
  addressUpdateSchema,
  type AddressDto,
} from "@closebuy/types";
import {
  createCustomerAuthService,
  EmailAlreadyRegisteredError,
  InvalidCredentialsError,
  LoginLockedError,
  InvalidResetTokenError,
} from "./service.js";
import { createCustomerAddressService, AddressNotFoundError } from "./addresses.js";
import { createEmailClient } from "./email.js";
import { serializeUser } from "../../../lib/serialize-user.js";
import { requireAuth } from "../../../lib/auth-guard.js";

function serializeAddress(address: {
  id: string;
  label: string;
  lat: number;
  lng: number;
  landmarkDescription: string;
  contactPhone: string;
  isWithinServiceArea: boolean;
}): AddressDto {
  return {
    id: address.id,
    label: address.label,
    lat: address.lat,
    lng: address.lng,
    landmarkDescription: address.landmarkDescription,
    contactPhone: address.contactPhone,
    isWithinServiceArea: address.isWithinServiceArea,
  };
}

/**
 * Customer — email/password (brief §3.1b). Vendor/rider/admin phone+OTP
 * auth lives in ../routes.js, their email/password in ../email.js.
 * Google/Apple for all four roles lives in ../oauth-routes.js — customer
 * used to own that here, generalized out once vendor/rider/admin needed
 * it too (same discovery/PKCE plumbing, just role-aware now).
 */
export async function customerAuthRoutes(app: FastifyInstance) {
  const email = createEmailClient(app.env.RESEND_API_KEY);
  const appBaseUrl = app.env.CUSTOMER_APP_URL;

  const addresses = createCustomerAddressService({ prisma: app.prisma });

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

  // ── Profile ──────────────────────────────────────────────────────────
  // Just `defaultPhone` so far — the one field checkout presets from
  // (brief §3.1b). CustomerProfile is created empty at register/OAuth
  // signup (service.ts), so findUniqueOrThrow is safe for any signed-in
  // customer.

  app.get("/customer/profile", { preHandler: requireAuth(["customer"]) }, async (req, reply) => {
    const profile = await app.prisma.customerProfile.findUniqueOrThrow({ where: { userId: req.authUser!.sub } });
    return reply.send({ profile: { defaultPhone: profile.defaultPhone } });
  });

  app.patch("/customer/profile", { preHandler: requireAuth(["customer"]) }, async (req, reply) => {
    const body = customerProfileUpdateSchema.parse(req.body);
    const profile = await app.prisma.customerProfile.update({
      where: { userId: req.authUser!.sub },
      data: { defaultPhone: body.defaultPhone },
    });
    return reply.send({ profile: { defaultPhone: profile.defaultPhone } });
  });

  // ── Saved addresses (US-C-05) ───────────────────────────────────────
  // Never authoritative for an order — checkout always carries its own
  // copied deliveryLat/deliveryLng/deliveryLandmark (data-model.md
  // §"Address"). This is "reuse next time" convenience only.

  app.get("/customer/addresses", { preHandler: requireAuth(["customer"]) }, async (req, reply) => {
    const profile = await app.prisma.customerProfile.findUniqueOrThrow({ where: { userId: req.authUser!.sub } });
    const list = await addresses.listAddresses(profile.id);
    return reply.send({ addresses: list.map(serializeAddress) });
  });

  app.post("/customer/addresses", { preHandler: requireAuth(["customer"]) }, async (req, reply) => {
    const body = addressCreateSchema.parse(req.body);
    const profile = await app.prisma.customerProfile.findUniqueOrThrow({ where: { userId: req.authUser!.sub } });
    const address = await addresses.createAddress(profile.id, body);
    return reply.code(201).send({ address: serializeAddress(address) });
  });

  app.patch("/customer/addresses/:id", { preHandler: requireAuth(["customer"]) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = addressUpdateSchema.parse(req.body);
    const profile = await app.prisma.customerProfile.findUniqueOrThrow({ where: { userId: req.authUser!.sub } });
    try {
      const address = await addresses.updateAddress(profile.id, id, body);
      return reply.send({ address: serializeAddress(address) });
    } catch (err) {
      if (err instanceof AddressNotFoundError) {
        return reply.code(404).send({ error: { code: "NOT_FOUND", message: err.message } });
      }
      throw err;
    }
  });

  app.delete("/customer/addresses/:id", { preHandler: requireAuth(["customer"]) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const profile = await app.prisma.customerProfile.findUniqueOrThrow({ where: { userId: req.authUser!.sub } });
    try {
      await addresses.deleteAddress(profile.id, id);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof AddressNotFoundError) {
        return reply.code(404).send({ error: { code: "NOT_FOUND", message: err.message } });
      }
      throw err;
    }
  });
}
