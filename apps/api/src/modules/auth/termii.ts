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

const TERMII_BASE_URL = "https://api.ng.termii.com/api";

export interface TermiiClient {
  sendOtp(phone: string): Promise<{ pinId: string }>;
  verifyOtp(pinId: string, code: string): Promise<{ verified: boolean }>;
}

export function createTermiiClient(apiKey: string, senderId: string): TermiiClient {
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
          pin_attempts: 5, // US-C-01: 5 failed attempts locks further attempts
          pin_time_to_live: 10, // minutes — US-C-01: code expires after 10 minutes
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
