import type { ApiClient } from "./client";
import type { AuthSession, OtpRequestInput, OtpVerifyInput } from "@closebuy/types";

export function createAuthApi(client: ApiClient) {
  return {
    requestOtp: (input: OtpRequestInput) =>
      client.request<void>("/auth/otp/request", { method: "POST", body: JSON.stringify(input) }),

    verifyOtp: (input: OtpVerifyInput) =>
      client.request<AuthSession>("/auth/otp/verify", { method: "POST", body: JSON.stringify(input) }),

    refresh: (refreshToken: string) =>
      client.request<{ accessToken: string }>("/auth/refresh", {
        method: "POST",
        body: JSON.stringify({ refreshToken }),
      }),
  };
}
