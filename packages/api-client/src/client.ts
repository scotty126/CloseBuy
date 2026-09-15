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

export interface CreateApiClientOptions {
  baseUrl: string;
  getAccessToken?: () => string | null;
}

/**
 * Thin fetch wrapper shared by every app — one place that knows how to talk
 * to the API (base URL, JSON, auth header, error shape), so each app's own
 * code only ever calls typed functions like `requestOtp(...)`, never fetch
 * directly. This is the whole point of a shared package: one integration
 * bug fixed here fixes it in all four apps at once.
 */
export function createApiClient({ baseUrl, getAccessToken }: CreateApiClientOptions) {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const token = getAccessToken?.();
    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init?.headers,
      },
    });

    if (res.status === 204) {
      return undefined as T;
    }

    const body = await res.json().catch(() => undefined);

    if (!res.ok) {
      const err = body as ApiError | undefined;
      throw new ApiClientError(res.status, err?.error.code ?? "UNKNOWN", err?.error.message ?? res.statusText);
    }

    return body as T;
  }

  return { request };
}

export type ApiClient = ReturnType<typeof createApiClient>;
