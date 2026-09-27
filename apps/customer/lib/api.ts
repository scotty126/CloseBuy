"use client";

import { createApiClient, createAuthApi, createCustomerAuthApi, createCatalogApi, createOrderApi } from "@closebuy/api-client";

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

function getRefreshToken(): string | null {
  try {
    const raw = window.localStorage.getItem("closebuy.session");
    if (!raw) return null;
    return (JSON.parse(raw) as { refreshToken: string }).refreshToken;
  } catch {
    return null;
  }
}

// Access tokens live 15 minutes (apps/api/src/lib/jwt.ts) — this is what
// makes a session outlive that instead of every request failing with
// "Invalid or expired token" the moment it does. The retried request
// re-reads the token via getAccessToken above, so persisting it here is
// enough; nothing needs to be told to re-render.
function onAccessTokenRefreshed(accessToken: string) {
  try {
    const raw = window.localStorage.getItem("closebuy.session");
    if (!raw) return;
    window.localStorage.setItem("closebuy.session", JSON.stringify({ ...JSON.parse(raw), accessToken }));
  } catch {
    // Best effort — worst case the next request refreshes again.
  }
}

// Only reached if the *refresh* token is also dead (30 days idle, or a
// secret rotation) — silent recovery isn't possible. Unlike the staff apps,
// a customer session is optional almost everywhere (guest checkout, guest
// tracking), so this clears the dead session but does NOT force a redirect —
// most screens work fine logged out, and bouncing a guest to /login mid-browse
// would be wrong.
function onSessionExpired() {
  try {
    window.localStorage.removeItem("closebuy.session");
  } catch {
    // no-op
  }
}

const client = createApiClient({ baseUrl: API_BASE_URL, getAccessToken, getRefreshToken, onAccessTokenRefreshed, onSessionExpired });
export const customerAuthApi = createCustomerAuthApi(client);
// `.me()` — shared across roles, used by the OAuth-complete landing page.
export const authApi = createAuthApi(client);
export const catalogApi = createCatalogApi(client);
export const orderApi = createOrderApi(client);

// Plain browser navigations, not fetch calls — the API redirects to
// Google/Apple itself (brief §3.1b, api-contracts.md).
// `role=customer` is the API's own default when missing, but explicit
// here for the same reason vendor/rider/admin's lib/api.ts now are.
export const googleSignInUrl = `${API_BASE_URL}/auth/oauth/google?role=customer`;
export const appleSignInUrl = `${API_BASE_URL}/auth/oauth/apple?role=customer`;
