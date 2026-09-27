import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { PaymentsUnavailableError } from "../modules/payments/monnify.js";
import { GeocodeUnavailableError } from "../modules/geocode/service.js";

/**
 * The one error shape every client parses: `{ error: { code, message } }`
 * (`ApiError` in packages/api-client). Routes that catch their own domain
 * errors already send it; this is the net for everything they don't —
 * before it existed, an uncaught error went out in Fastify's default
 * `{ statusCode, error: "Internal Server Error", message }` shape instead.
 * The client couldn't find `error.message` in that, fell back to
 * `res.statusText` (empty over HTTP/2), and showed nothing at all: a customer
 * typing a phone number as `0801…` on checkout tapped "Place order" and
 * nothing happened. Zod failures (`schema.parse` throws) were the worst hit —
 * every validation error in the API was a 500.
 */

interface ZodIssueLike {
  path: (string | number)[];
  message: string;
}

// `name` as well as instanceof: the schemas live in packages/types, which may resolve its own copy of zod.
function isZodError(err: unknown): err is { issues: ZodIssueLike[] } {
  const e = err as { name?: string; issues?: unknown };
  return e?.name === "ZodError" && Array.isArray(e.issues);
}

function describeIssue(issue: ZodIssueLike): string {
  const field = issue.path.join(".");
  // "contactPhone: Phone number must be…" — a bare "Required" is useless without saying which field.
  return field ? `${field}: ${issue.message}` : issue.message;
}

const STATUS_CODES: Record<number, string> = {
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  413: "PAYLOAD_TOO_LARGE",
  415: "UNSUPPORTED_MEDIA_TYPE",
  422: "UNPROCESSABLE",
  429: "RATE_LIMITED",
};

export function apiErrorHandler(err: FastifyError | Error, req: FastifyRequest, reply: FastifyReply) {
  if (isZodError(err)) {
    return reply.code(400).send({
      error: {
        code: "VALIDATION_ERROR",
        message: err.issues.slice(0, 3).map(describeIssue).join("; "),
      },
    });
  }

  if (err instanceof PaymentsUnavailableError) {
    // Expected while Monnify is unconfigured (CLAUDE.md, Known issues) — a clear 503, not a crash.
    // A `cause` means the gateway was configured but failed; that one is worth a log line.
    if (err.cause) req.log.warn({ err: err.cause }, "payment gateway call failed");
    return reply.code(503).send({ error: { code: "PAYMENTS_UNAVAILABLE", message: err.message } });
  }

  if (err instanceof GeocodeUnavailableError) {
    // Nominatim down/timed out/erroring — a clear 503. Never fatal to checkout itself: the frontend's
    // current-location and manual-coordinate paths don't go through this endpoint at all.
    if (err.cause) req.log.warn({ err: err.cause }, "geocode provider call failed");
    return reply.code(503).send({ error: { code: "GEOCODE_UNAVAILABLE", message: err.message } });
  }

  // Fastify's own 4xx (bad JSON body, oversized body, unsupported media type)
  // and @fastify/rate-limit's 429 carry a statusCode and a message meant for
  // the caller. Anything at 500+ is ours, and its message is not.
  const status = (err as { statusCode?: number }).statusCode;
  if (typeof status === "number" && status >= 400 && status < 500) {
    return reply.code(status).send({
      error: { code: (err as { code?: string }).code ?? STATUS_CODES[status] ?? "REQUEST_ERROR", message: err.message || "The request couldn't be processed." },
    });
  }

  req.log.error({ err }, "unhandled error");
  return reply.code(500).send({
    error: { code: "INTERNAL_ERROR", message: "Something went wrong on our side. Please try again in a moment." },
  });
}

export function apiNotFoundHandler(_req: FastifyRequest, reply: FastifyReply) {
  return reply.code(404).send({ error: { code: "NOT_FOUND", message: "That doesn't exist." } });
}
