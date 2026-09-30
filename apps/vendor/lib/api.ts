"use client";

import { createApiClient, createAuthApi, createCatalogApi, createOrderApi, createPayoutsApi, createNotificationsApi } from "@closebuy/api-client";

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
// secret rotation) — silent recovery isn't possible, so send the person
// back to sign in instead of leaving every screen stuck on a 401.
function onSessionExpired() {
  try {
    window.localStorage.removeItem("closebuy.session");
  } catch {
    // no-op
  }
  if (typeof window !== "undefined" && window.location.pathname !== "/login") {
    window.location.href = "/login";
  }
}

const client = createApiClient({ baseUrl, getAccessToken, getRefreshToken, onAccessTokenRefreshed, onSessionExpired });
export const authApi = createAuthApi(client);
export const catalogApi = createCatalogApi(client);
export const orderApi = createOrderApi(client);
export const payoutsApi = createPayoutsApi(client);
export const notificationsApi = createNotificationsApi(client);

// Plain browser navigations, not fetch calls — the API redirects to
// Google/Apple itself. `role=vendor` tells the shared OAuth callback
// (apps/api's oauth-routes.ts) which app/account type this is and where
// to redirect back to.
export const googleSignInUrl = `${baseUrl}/auth/oauth/google?role=vendor`;
export const appleSignInUrl = `${baseUrl}/auth/oauth/apple?role=vendor`;
