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
