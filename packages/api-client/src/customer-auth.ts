import type { ApiClient } from "./client.js";
import type {
  AuthSession,
  RegisterInput,
  LoginInput,
  ForgotPasswordInput,
  ResetPasswordInput,
  CustomerProfileDto,
  CustomerProfileUpdateInput,
} from "@closebuy/types";

/** Customer — email/password or Google/Apple (brief §3.1b). Vendor/rider/admin still use the plain `createAuthApi` (phone OTP). */
export function createCustomerAuthApi(client: ApiClient) {
  return {
    register: (input: RegisterInput) =>
      client.request<AuthSession>("/auth/register", { method: "POST", body: JSON.stringify(input) }),

    login: (input: LoginInput) =>
      client.request<AuthSession>("/auth/login", { method: "POST", body: JSON.stringify(input) }),

    forgotPassword: (input: ForgotPasswordInput) =>
      client.request<void>("/auth/forgot-password", { method: "POST", body: JSON.stringify(input) }),

    resetPassword: (input: ResetPasswordInput) =>
      client.request<void>("/auth/reset-password", { method: "POST", body: JSON.stringify(input) }),

    verifyEmail: (token: string) =>
      client.request<{ verified: boolean }>("/auth/verify-email", {
        method: "POST",
        body: JSON.stringify({ token }),
      }),

    getProfile: () => client.request<{ profile: CustomerProfileDto }>("/customer/profile"),

    updateProfile: (input: CustomerProfileUpdateInput) =>
      client.request<{ profile: CustomerProfileDto }>("/customer/profile", {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
  };
}
