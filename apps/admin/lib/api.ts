"use client";

import { createApiClient, createAuthApi, createAdminApi } from "@closebuy/api-client";

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
export const adminApi = createAdminApi(client);
