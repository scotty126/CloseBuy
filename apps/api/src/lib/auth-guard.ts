import type { FastifyRequest, FastifyReply } from "fastify";
import type { UserRole, AccessTokenClaims } from "@closebuy/types";
import { verifyAccessToken } from "./jwt.js";

declare module "fastify" {
  interface FastifyRequest {
    authUser?: AccessTokenClaims;
  }
}

/**
 * Verifies the bearer token and attaches the claims to the request.
 * Role/ownership checks (e.g. "a customer can only read their own orders")
 * happen in each route handler, not here — this only answers "who is this."
 */
export function requireAuth(roles?: UserRole[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      return reply.code(401).send({ error: { code: "UNAUTHENTICATED", message: "Missing bearer token" } });
    }

    try {
      const claims = verifyAccessToken(header.slice("Bearer ".length), req.server.env.JWT_ACCESS_SECRET);
      if (roles && !roles.includes(claims.role)) {
        return reply.code(403).send({ error: { code: "FORBIDDEN", message: "Role not permitted" } });
      }
      req.authUser = claims;
    } catch {
      return reply.code(401).send({ error: { code: "UNAUTHENTICATED", message: "Invalid or expired token" } });
    }
  };
}
