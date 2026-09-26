import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { checkoutSchema } from "@closebuy/types";
import { apiErrorHandler, apiNotFoundHandler } from "./error-handler.js";
import { PaymentsUnavailableError } from "../modules/payments/monnify.js";

function buildTestApp() {
  const app = Fastify();
  app.setErrorHandler(apiErrorHandler);
  app.setNotFoundHandler(apiNotFoundHandler);
  app.post("/checkout", async (req) => checkoutSchema.parse(req.body)); // the real schema — the bug came from a real form
  app.get("/gateway", async () => {
    throw new PaymentsUnavailableError();
  });
  app.get("/boom", async () => {
    throw new Error("connect ECONNREFUSED 10.0.0.5:5432 — internal detail that must not reach a customer");
  });
  app.get("/limited", async () => {
    // The shape @fastify/rate-limit throws: a plain object with a statusCode.
    throw { statusCode: 429, error: "Too Many Requests", message: "Rate limit exceeded, retry in 1 minute" };
  });
  return app;
}

describe("apiErrorHandler", () => {
  it("turns a zod failure into a 400 in the { error: { code, message } } shape, naming the field", async () => {
    // A customer typed their number the usual Nigerian way; this used to be a 500 the UI rendered as nothing at all.
    const res = await buildTestApp().inject({
      method: "POST",
      url: "/checkout",
      payload: {
        vendorId: "0f8fad5b-d9cb-469f-a165-70867728950e",
        items: [{ productId: "0f8fad5b-d9cb-469f-a165-70867728950e", quantity: 1 }],
        fulfilmentType: "pickup",
        paymentMethod: "card",
        contactPhone: "08012345678",
      },
    });

    expect(res.statusCode).toBe(400);
    const { error } = res.json();
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.message).toContain("contactPhone");
    expect(error.message).toContain("E.164");
  });

  it("answers 503 PAYMENTS_UNAVAILABLE for a missing gateway", async () => {
    const res = await buildTestApp().inject({ method: "GET", url: "/gateway" });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("PAYMENTS_UNAVAILABLE");
    expect(res.json().error.message).toMatch(/cash on delivery/i);
  });

  it("never leaks the message of an unexpected error", async () => {
    const res = await buildTestApp().inject({ method: "GET", url: "/boom" });
    expect(res.statusCode).toBe(500);
    expect(res.json().error.code).toBe("INTERNAL_ERROR");
    expect(res.body).not.toContain("ECONNREFUSED");
  });

  it("passes a rate-limit rejection through as a 429 in the same shape", async () => {
    const res = await buildTestApp().inject({ method: "GET", url: "/limited" });
    expect(res.statusCode).toBe(429);
    expect(res.json().error).toMatchObject({ code: "RATE_LIMITED", message: expect.stringContaining("Rate limit") });
  });

  it("reports Fastify's own bad-request errors (malformed JSON) as a 400 in the same shape", async () => {
    const res = await buildTestApp().inject({
      method: "POST",
      url: "/checkout",
      headers: { "content-type": "application/json" },
      payload: "{ not json",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toBeTruthy();
  });

  it("gives an unknown route the same shape too", async () => {
    const res = await buildTestApp().inject({ method: "GET", url: "/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });
});
