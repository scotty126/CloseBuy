export interface ApiError {
  error: { code: string; message: string };
}

export class ApiClientError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Pulls a code and message out of an error body without assuming its shape.
 * The API's own shape is `{ error: { code, message } }`, but a proxy, a
 * framework default (`{ statusCode, error: "Bad Request", message }`) or a
 * non-JSON body can arrive instead — and reading `.message` off the string
 * in `error` quietly yields undefined. Callers used to fall back to
 * `res.statusText`, which is empty over HTTP/2, so the form showed no error
 * at all and "Place order" appeared to do nothing.
 */
function readError(body: unknown): { code: string; message: string } {
  const b = body as { error?: unknown; message?: unknown } | undefined;
  if (b && typeof b.error === "object" && b.error !== null) {
    const e = b.error as { code?: unknown; message?: unknown };
    return {
      code: typeof e.code === "string" ? e.code : "UNKNOWN",
      message: typeof e.message === "string" ? e.message : "",
    };
  }
  return { code: "UNKNOWN", message: typeof b?.message === "string" ? b.message : "" };
}

export interface CreateApiClientOptions {
  baseUrl: string;
  getAccessToken?: () => string | null;
  /**
   * Enables silent refresh-on-401. Access tokens live 15 minutes
   * (apps/api/src/lib/jwt.ts) — without this, any session older than that
   * failed every request with "Invalid or expired token" until the person
   * signed out and back in. `POST /auth/refresh` existed and
   * `authApi.refresh()` was even exported, but nothing ever called it.
   */
  getRefreshToken?: () => string | null;
  /** Called right after a silent refresh succeeds, so the caller can persist the new access token before the retried request re-reads it via `getAccessToken`. */
  onAccessTokenRefreshed?: (accessToken: string) => void;
  /** Called when refresh itself fails (refresh token expired/invalid too) — recovery isn't silent anymore, so the caller should clear the stored session and send the person back to sign in. */
  onSessionExpired?: () => void;
}

/**
 * Thin fetch wrapper shared by every app — one place that knows how to talk
 * to the API (base URL, JSON, auth header, error shape), so each app's own
 * code only ever calls typed functions like `requestOtp(...)`, never fetch
 * directly. This is the whole point of a shared package: one integration
 * bug fixed here fixes it in all four apps at once.
 */
export function createApiClient({ baseUrl, getAccessToken, getRefreshToken, onAccessTokenRefreshed, onSessionExpired }: CreateApiClientOptions) {
  // A page that fires several authed requests at once (a dashboard hydrating
  // multiple widgets) must not fire a separate refresh per request — they'd
  // each succeed independently (refresh is stateless, no rotation, see
  // apps/api/src/modules/auth/routes.ts) but that's still wasted round-trips
  // and wasted retries. Every 401 that arrives while one is in flight shares it.
  let refreshInFlight: Promise<string> | null = null;

  function refreshAccessToken(): Promise<string> {
    if (!refreshInFlight) {
      // Raw fetch, not `request()` — refreshing must never itself trigger a refresh.
      refreshInFlight = (async () => {
        const refreshToken = getRefreshToken?.();
        if (!refreshToken) throw new ApiClientError(401, "NO_REFRESH_TOKEN", "Not signed in.");
        const res = await fetch(`${baseUrl}/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken }),
        });
        if (!res.ok) throw new ApiClientError(res.status, "REFRESH_FAILED", "Session expired.");
        const { accessToken } = (await res.json()) as { accessToken: string };
        return accessToken;
      })().finally(() => {
        refreshInFlight = null;
      });
    }
    return refreshInFlight;
  }

  async function request<T>(path: string, init?: RequestInit, isRetry = false): Promise<T> {
    const token = getAccessToken?.();
    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        // Only set when there's actually a body — a bodyless POST (order
        // accept/ready/cancel, rider offer accept/decline, application
        // approve) sent with this header anyway hits Fastify's default
        // JSON parser as an empty body under an application/json
        // content-type, which it rejects outright (FST_ERR_CTP_EMPTY_JSON_BODY,
        // a real 400 against the live API, not hypothetical).
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init?.headers,
      },
    });

    if (res.status === 204) {
      return undefined as T;
    }

    // Retry exactly once, and only for a request that actually relied on an
    // access token (`token` truthy) — a 401 with no token attached is a real
    // auth failure (a login/OTP endpoint rejecting bad credentials, say), not
    // an expired one, and refreshing wouldn't change its outcome. A 401 from
    // the retried request itself (isRetry) falls straight through: the fresh
    // token was already used and still failed for some other reason, so
    // showing that error beats silently retrying forever.
    if (res.status === 401 && !isRetry && token && getRefreshToken) {
      try {
        const freshToken = await refreshAccessToken();
        onAccessTokenRefreshed?.(freshToken);
        return request<T>(path, init, true);
      } catch {
        onSessionExpired?.();
        // fall through — report the *original* 401 below, since refresh itself failed
      }
    }

    const body = await res.json().catch(() => undefined);

    if (!res.ok) {
      const { code, message } = readError(body);
      throw new ApiClientError(res.status, code, message || res.statusText || `Something went wrong (HTTP ${res.status}). Please try again.`);
    }

    return body as T;
  }

  return { request };
}

export type ApiClient = ReturnType<typeof createApiClient>;
