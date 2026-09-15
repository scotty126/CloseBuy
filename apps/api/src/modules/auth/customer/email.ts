import { Resend } from "resend";

/**
 * Customer account-security email — verification on signup, password
 * reset (brief §3.1b). Neither ever blocks using the account; this is a
 * courtesy notification, not a gate.
 */
export interface EmailClient {
  sendVerificationEmail(to: string, verifyUrl: string): Promise<void>;
  sendPasswordResetEmail(to: string, resetUrl: string): Promise<void>;
}

export function createEmailClient(apiKey: string | undefined): EmailClient {
  if (!apiKey) {
    // Boots fine without a key (env.ts) — fails loudly and specifically
    // right here, the moment an email actually needs sending, rather than
    // silently no-op-ing (which would look like a working signup with an
    // email nobody ever receives).
    const missingKeyError = () => {
      throw new Error(
        "RESEND_API_KEY is not set — see .env.example. Customer email verification/reset cannot send without it.",
      );
    };
    return {
      sendVerificationEmail: async () => missingKeyError(),
      sendPasswordResetEmail: async () => missingKeyError(),
    };
  }

  const resend = new Resend(apiKey);

  return {
    async sendVerificationEmail(to, verifyUrl) {
      await resend.emails.send({
        from: "CloseBuy <no-reply@closebuy.app>",
        to,
        subject: "Verify your CloseBuy email",
        html: `<p>Confirm your email to secure your account (this doesn't block anything — you can keep shopping either way):</p><p><a href="${verifyUrl}">${verifyUrl}</a></p>`,
      });
    },

    async sendPasswordResetEmail(to, resetUrl) {
      await resend.emails.send({
        from: "CloseBuy <no-reply@closebuy.app>",
        to,
        subject: "Reset your CloseBuy password",
        html: `<p>Reset your password — this link is single-use and expires soon:</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>Didn't request this? Ignore this email.</p>`,
      });
    },
  };
}
