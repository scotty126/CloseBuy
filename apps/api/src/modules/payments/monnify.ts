import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Monnify client — ADR-0001: primary payment gateway, chosen for
 * multi-daily settlement. Every shape here is verified against Monnify's
 * actual docs (not assumed) — sources noted per section, since a wrong
 * webhook-signature implementation is a real security bug, not just a
 * bad guess:
 * - Auth: POST /api/v1/auth/login, `Authorization: Basic base64(apiKey:secretKey)`,
 *   returns a Bearer token expiring in 1 hour.
 * - Initialize Transaction: POST /api/v1/merchant/transactions/init-transaction,
 *   `incomeSplitConfig` is the Sub-Accounts split mechanism ADR-0001/R-01 lean on.
 * - Webhook signature: header `monnify-signature`, HMAC-SHA512(secretKey, rawBody).
 *   (developers.monnify.com/docs/integration-tools/webhooks;
 *   teamapt.atlassian.net/wiki/spaces/MON/pages/212008918)
 * - Webhook payload: `{ eventType: "SUCCESSFUL_TRANSACTION", eventData: {
 *   paymentReference, transactionReference, amountPaid, paymentStatus: "PAID", ... } }`
 *   (teamapt.atlassian.net/wiki/spaces/MON/pages/320864320)
 * - Refund: POST /api/v1/refunds/initiate-refund, `{ transactionReference,
 *   refundReference, refundAmount, refundReason }` (teamapt.atlassian.net/wiki/spaces/MON/pages/229900080)
 */

const SANDBOX_BASE_URL = "https://sandbox.monnify.com";
const PRODUCTION_BASE_URL = "https://api.monnify.com";

export interface MonnifySplitConfig {
  subAccountCode: string;
  feePercentage: number;
  splitAmountMinor?: number;
  splitPercentage?: number;
  feeBearer: boolean;
}

export interface InitializeTransactionInput {
  amountMinor: number;
  customerName: string;
  customerEmail: string;
  paymentReference: string; // our idempotency key — becomes Payment.gatewayReference
  paymentDescription: string;
  redirectUrl: string;
  splitConfig?: MonnifySplitConfig[];
}

export interface RefundInput {
  transactionReference: string;
  refundReference: string; // our idempotency key for the refund itself
  amountMinor: number;
  reason: string;
}

export interface WebhookEvent {
  eventType: string; // "SUCCESSFUL_TRANSACTION" is the one this codebase acts on
  eventData: {
    paymentReference: string; // matches Payment.gatewayReference
    transactionReference: string;
    amountPaid: number; // major units (Naira)
    paymentStatus: string; // "PAID" on success
  };
}

export interface MonnifyClient {
  initializeTransaction(input: InitializeTransactionInput): Promise<{ checkoutUrl: string; transactionReference: string }>;
  verifyWebhookSignature(rawBody: string, signatureHeader: string | undefined): boolean;
  refund(input: RefundInput): Promise<void>;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number; // epoch ms
}

export function createMonnifyClient(
  apiKey: string | undefined,
  secretKey: string | undefined,
  contractCode: string | undefined,
  env: "development" | "test" | "production",
): MonnifyClient {
  if (!apiKey || !secretKey || !contractCode) {
    const missingCredentialsError = () => {
      throw new Error(
        "MONNIFY_API_KEY / MONNIFY_SECRET_KEY / MONNIFY_CONTRACT_CODE are not set — see .env.example. Checkout cannot charge a card/transfer without them (cash on delivery is unaffected).",
      );
    };
    return {
      initializeTransaction: async () => missingCredentialsError(),
      // Signature verification with no secret configured must fail closed,
      // not throw past the caller — an unconfigured gateway should reject
      // every webhook, never accept one because verification never ran.
      verifyWebhookSignature: () => false,
      refund: async () => missingCredentialsError(),
    };
  }

  const baseUrl = env === "production" ? PRODUCTION_BASE_URL : SANDBOX_BASE_URL;
  let cachedToken: CachedToken | null = null;

  async function getAccessToken(): Promise<string> {
    if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
      return cachedToken.accessToken;
    }

    const basic = Buffer.from(`${apiKey}:${secretKey}`).toString("base64");
    const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { Authorization: `Basic ${basic}` },
    });
    if (!res.ok) {
      throw new Error(`Monnify auth failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as { responseBody: { accessToken: string; expiresIn: number } };

    cachedToken = {
      accessToken: data.responseBody.accessToken,
      expiresAt: Date.now() + data.responseBody.expiresIn * 1000,
    };
    return cachedToken.accessToken;
  }

  return {
    async initializeTransaction(input) {
      const accessToken = await getAccessToken();

      const res = await fetch(`${baseUrl}/api/v1/merchant/transactions/init-transaction`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: input.amountMinor / 100, // Monnify takes major units (Naira), not kobo
          customerName: input.customerName,
          customerEmail: input.customerEmail,
          paymentReference: input.paymentReference,
          paymentDescription: input.paymentDescription,
          currencyCode: "NGN",
          contractCode,
          redirectUrl: input.redirectUrl,
          paymentMethods: ["CARD", "ACCOUNT_TRANSFER"],
          ...(input.splitConfig
            ? {
                incomeSplitConfig: input.splitConfig.map((s) => ({
                  subAccountCode: s.subAccountCode,
                  feePercentage: s.feePercentage,
                  feeBearer: s.feeBearer,
                  ...(s.splitAmountMinor !== undefined
                    ? { splitAmount: s.splitAmountMinor / 100 }
                    : { splitPercentage: s.splitPercentage }),
                })),
              }
            : {}),
        }),
      });
      if (!res.ok) {
        throw new Error(`Monnify initialize-transaction failed: ${res.status} ${await res.text()}`);
      }
      const data = (await res.json()) as {
        responseBody: { checkoutUrl: string; transactionReference: string };
      };
      return {
        checkoutUrl: data.responseBody.checkoutUrl,
        transactionReference: data.responseBody.transactionReference,
      };
    },

    verifyWebhookSignature(rawBody, signatureHeader) {
      if (!signatureHeader) return false;

      const expected = createHmac("sha512", secretKey).update(rawBody).digest("hex");
      const expectedBuf = Buffer.from(expected, "hex");
      const receivedBuf = Buffer.from(signatureHeader, "hex");

      // Constant-time comparison, not `===` — a signature check is a
      // security boundary, and unequal-length buffers must fail closed,
      // not throw (timingSafeEqual requires equal lengths).
      if (expectedBuf.length !== receivedBuf.length) return false;
      return timingSafeEqual(expectedBuf, receivedBuf);
    },

    async refund(input) {
      const accessToken = await getAccessToken();
      const res = await fetch(`${baseUrl}/api/v1/refunds/initiate-refund`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          transactionReference: input.transactionReference,
          refundReference: input.refundReference,
          refundAmount: input.amountMinor / 100,
          refundReason: input.reason,
        }),
      });
      if (!res.ok) {
        throw new Error(`Monnify refund failed: ${res.status} ${await res.text()}`);
      }
    },
  };
}
