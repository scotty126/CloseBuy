"use client";

import { createApiClient, createAuthApi, createCustomerAuthApi } from "@closebuy/api-client";

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export function getAccessToken(): string | null {
  try {
    const raw = window.localStorage.getItem("closebuy.session");
    if (!raw) return null;
    return (JSON.parse(raw) as { accessToken: string }).accessToken;
  } catch {
    return null;
  }
}

const client = createApiClient({ baseUrl: API_BASE_URL, getAccessToken });
export const customerAuthApi = createCustomerAuthApi(client);
// `.me()` — shared across roles, used by the OAuth-complete landing page.
export const authApi = createAuthApi(client);

// Plain browser navigations, not fetch calls — the API redirects to
// Google/Apple itself (brief §3.1b, api-contracts.md).
export const googleSignInUrl = `${API_BASE_URL}/auth/oauth/google`;
export const appleSignInUrl = `${API_BASE_URL}/auth/oauth/apple`;
