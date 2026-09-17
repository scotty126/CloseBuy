/**
 * Termii SMS client — ADR-0001: chosen over Twilio for deliverability and
 * cost into Nigerian numbers specifically.
 *
 * Docs: https://developer.termii.com/ — this hits the /api/sms/otp/send
 * and /api/sms/otp/verify endpoints, which means Termii owns OTP
 * generation and expiry, not us. If that ever needs to change (e.g. to
 * generate codes ourselves and just send them as plain SMS via Termii's
 * /api/sms/send instead), only this file changes — the rest of the auth
 * module talks to `TermiiClient`, not to Termii's HTTP API directly.
 */

import { randomInt, randomUUID } from "node:crypto";

const TERMII_BASE_URL = "https://api.ng.termii.com/api";

export interface TermiiClient {
  sendOtp(phone: string): Promise<{ pinId: string; devCode?: string }>;
  verifyOtp(pinId: string, code: string): Promise<{ verified: boolean }>;
}

/**
 * Returns a client that throws a clear, specific error the moment it's
 * actually used, rather than at boot, when either credential is missing —
 * same pattern as createEmailClient (customer/email.ts). A registered
 * Sender ID needs CAC business verification, which can take a while; there
 * is no reason vendor/rider onboarding UI (unbuilt regardless, M1) or
 * anything else should be blocked on that in the meantime.
 */
export function createTermiiClient(apiKey: string | undefined, senderId: string | undefined): TermiiClient {
  if (!apiKey || !senderId) {
    const missingCredentialsError = () => {
      throw new Error(
        "TERMII_API_KEY / TERMII_SENDER_ID are not set — see .env.example. Vendor/rider/admin OTP cannot send without them.",
      );
    };
    return {
      sendOtp: async () => missingCredentialsError(),
      verifyOtp: async () => missingCredentialsError(),
    };
  }

  return {
    async sendOtp(phone: string) {
      const res = await fetch(`${TERMII_BASE_URL}/sms/otp/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: apiKey,
          message_type: "NUMERIC",
          to: phone,
          from: senderId,
          channel: "generic",
          pin_attempts: 5, // US-V-01 / US-R-01: 5 failed attempts locks further attempts
          pin_time_to_live: 10, // minutes — code expires after 10 minutes
          pin_length: 6,
          pin_placeholder: "< 123456 >",
          message_text: "Your CloseBuy verification code is < 123456 >. It expires in 10 minutes.",
        }),
      });

      if (!res.ok) {
        throw new Error(`Termii sendOtp failed: ${res.status} ${await res.text()}`);
      }

      const data = (await res.json()) as { pinId: string };
      return { pinId: data.pinId };
    },

    async verifyOtp(pinId: string, code: string) {
      const res = await fetch(`${TERMII_BASE_URL}/sms/otp/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: apiKey, pin_id: pinId, pin: code }),
      });

      if (!res.ok) {
        throw new Error(`Termii verifyOtp failed: ${res.status} ${await res.text()}`);
      }

      const data = (await res.json()) as { verified: boolean };
      return { verified: data.verified === true };
    },
  };
}

/**
 * Stands in for Termii while TERMII_SENDER_ID is pending CAC approval
 * (OTP_DEV_FALLBACK=true — see env.ts, opt-in only, never automatic).
 * Generates a real 6-digit code and holds it in memory instead of
 * sending an SMS, so the real requestOtp/verifyOtp flow — lockout
 * included — can be exercised end to end without a phone. The code is
 * logged and also handed back in sendOtp's own return value so routes.ts
 * can surface it directly in the response; a real deploy with real
 * TERMII_API_KEY/TERMII_SENDER_ID never reaches this path at all.
 */
export function createDevOtpClient(): TermiiClient {
  const codesByPinId = new Map<string, string>();

  return {
    async sendOtp(phone: string) {
      const pinId = randomUUID();
      const code = String(randomInt(100000, 999999));
      codesByPinId.set(pinId, code);
      console.log(`[otp-dev-fallback] code for ${phone}: ${code} (Termii not configured — TERMII_SENDER_ID pending CAC approval)`);
      return { pinId, devCode: code };
    },

    async verifyOtp(pinId: string, code: string) {
      return { verified: codesByPinId.get(pinId) === code };
    },
  };
}
