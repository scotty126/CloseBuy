import type { User } from "@prisma/client";

/** Matches packages/types' authSessionSchema.user shape (brief §3.1b) — shared by both the staff (phone/OTP) and customer (email/password/OAuth) auth paths so the response shape never drifts between them. */
export function serializeUser(user: User) {
  return {
    id: user.id,
    role: user.role,
    email: user.email,
    emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
    phone: user.phone,
    phoneVerifiedAt: user.phoneVerifiedAt?.toISOString() ?? null,
  };
}
