import type { ApiClient } from "./client";
import type { AuthSession, OtpRequestInput, OtpRequestResponse, OtpVerifyInput, StaffRegisterInput, StaffLoginInput } from "@closebuy/types";

export function createAuthApi(client: ApiClient) {
  return {
    // `session` is only ever set by the dev auto-signin fast path
    // (DEV_AUTO_SIGNIN_PHONES) — when present, the caller already has a
    // full session and can skip straight past the code-entry step.
    requestOtp: async (input: OtpRequestInput): Promise<OtpRequestResponse> => {
      const res = await client.request<OtpRequestResponse & Partial<AuthSession>>("/auth/otp/request", {
        method: "POST",
        body: JSON.stringify(input),
      });
      // A server deployed before 2026-09-26 sent the auto-signin session's
      // fields at the top level instead of under `session`. Normalise it, so
      // the shortcut works against that server too — the check is on the
      // three fields a session must have, not just the shape's absence.
      // Dead code once the fixed API is deployed; safe to delete then.
      if (!res.session && res.accessToken && res.refreshToken && res.user) {
        return { session: { accessToken: res.accessToken, refreshToken: res.refreshToken, user: res.user } };
      }
      return res;
    },

    verifyOtp: (input: OtpVerifyInput) =>
      client.request<AuthSession>("/auth/otp/verify", { method: "POST", body: JSON.stringify(input) }),

    // Vendor/rider/admin's alternative to phone+OTP above.
    staffRegister: (input: StaffRegisterInput) =>
      client.request<AuthSession>("/auth/staff/register", { method: "POST", body: JSON.stringify(input) }),

    staffLogin: (input: StaffLoginInput) =>
      client.request<AuthSession>("/auth/staff/login", { method: "POST", body: JSON.stringify(input) }),

    refresh: (refreshToken: string) =>
      client.request<{ accessToken: string }>("/auth/refresh", {
        method: "POST",
        body: JSON.stringify({ refreshToken }),
      }),

    // Shared by every role — used to hydrate a session with the full user
    // object after the OAuth redirect landing, which only carries tokens.
    me: () => client.request<{ user: AuthSession["user"] }>("/auth/me"),
  };
}
