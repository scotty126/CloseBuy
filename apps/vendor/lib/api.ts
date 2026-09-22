"use client";

import { createApiClient, createAuthApi, createCatalogApi, createOrderApi } from "@closebuy/api-client";

const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export function getAccessToken(): string | null {
  try {
    const raw = window.localStorage.getItem("closebuy.session");
    if (!raw) return null;
    return (JSON.parse(raw) as { accessToken: string }).accessToken;
  } catch {
    return null;
  }
}

const client = createApiClient({ baseUrl, getAccessToken });
export const authApi = createAuthApi(client);
export const catalogApi = createCatalogApi(client);
export const orderApi = createOrderApi(client);

// Plain browser navigations, not fetch calls — the API redirects to
// Google/Apple itself. `role=vendor` tells the shared OAuth callback
// (apps/api's oauth-routes.ts) which app/account type this is and where
// to redirect back to.
export const googleSignInUrl = `${baseUrl}/auth/oauth/google?role=vendor`;
export const appleSignInUrl = `${baseUrl}/auth/oauth/apple?role=vendor`;
