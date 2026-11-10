import { Resend } from "resend";
import type { NotificationMessage } from "./messages.js";

export interface NotificationEmailer {
  isConfigured: boolean;
  /** Never throws — an email is an add-on to the in-app row, not a gate on whatever action triggered it. */
  send(to: string, message: NotificationMessage): Promise<boolean>;
}

/**
 * Same degrade-to-nothing pattern as the push client (push.ts): with no
 * RESEND_API_KEY this is inert and the in-app feed is still the record.
 * Unlike the customer verify/reset mailer (customer/email.ts), which fails
 * loudly because a signup that silently sends nothing is a broken signup,
 * a missing notification email is just a missing nice-to-have.
 */
export function createNotificationEmailer(apiKey: string | undefined, from: string): NotificationEmailer {
  if (!apiKey) {
    return { isConfigured: false, async send() { return false; } };
  }

  const resend = new Resend(apiKey);

  return {
    isConfigured: true,
    async send(to, message) {
      try {
        // Resend's SDK returns `{ error }` rather than throwing on an API
        // failure (e.g. a sender domain that isn't verified yet).
        const { error } = await resend.emails.send({
          from,
          to,
          subject: message.title,
          html: renderHtml(message),
          text: `${message.title}\n\n${message.body}\n\n— CloseBuy`,
        });
        if (error) {
          console.error("notification email failed", error);
          return false;
        }
        return true;
      } catch (err) {
        console.error("notification email failed", err);
        return false;
      }
    },
  };
}

// Messages are static strings from messages.ts (never user input), so no
// escaping is needed — but kept free of any `<`/`&` for the same reason.
function renderHtml({ title, body }: NotificationMessage): string {
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#10231C">
<p style="margin:0 0 4px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#FF5A19;font-weight:700">CloseBuy</p>
<h1 style="margin:0 0 12px;font-size:20px">${title}</h1>
<p style="margin:0 0 20px;font-size:15px;line-height:1.5">${body}</p>
<p style="margin:0;font-size:12px;color:#6B7A72">You are getting this because you have a CloseBuy account. Open the app to see more.</p>
</div>`;
}
