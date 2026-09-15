import jwt from "jsonwebtoken";
import type { AccessTokenClaims, UserRole } from "@closebuy/types";

const ACCESS_TOKEN_TTL = "15m";
const REFRESH_TOKEN_TTL = "30d";

export function signAccessToken(
  userId: string,
  role: UserRole,
  secret: string,
): string {
  return jwt.sign({ sub: userId, role } satisfies Omit<AccessTokenClaims, "iat" | "exp">, secret, {
    expiresIn: ACCESS_TOKEN_TTL,
  });
}

export function signRefreshToken(userId: string, secret: string): string {
  return jwt.sign({ sub: userId }, secret, { expiresIn: REFRESH_TOKEN_TTL });
}

export function verifyAccessToken(token: string, secret: string): AccessTokenClaims {
  return jwt.verify(token, secret) as AccessTokenClaims;
}

export function verifyRefreshToken(token: string, secret: string): { sub: string } {
  return jwt.verify(token, secret) as { sub: string };
}
