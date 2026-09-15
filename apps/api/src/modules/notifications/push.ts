import webPush, { WebPushError } from "web-push";

export interface PushSubscriptionData {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushSendResult {
  delivered: boolean;
  // The push service itself reports 404/410 for a subscription that no
  // longer exists (uninstalled, permission revoked, browser data
  // cleared) — the caller should delete it rather than keep retrying.
  expired: boolean;
}

export interface PushClient {
  isConfigured: boolean;
  send(subscription: PushSubscriptionData, payload: unknown): Promise<PushSendResult>;
}

/**
 * Returns a no-op client when VAPID keys aren't set, same pattern as
 * createTermiiClient/createMonnifyClient — the in-app feed
 * (GET /notifications) is the real, always-on record; this is strictly an
 * add-on that degrades to nothing rather than failing anything (US-A-01's
 * "applicant is notified" etc. is satisfied by the in-app row regardless).
 */
export function createPushClient(publicKey: string | undefined, privateKey: string | undefined, subject: string): PushClient {
  if (!publicKey || !privateKey) {
    return {
      isConfigured: false,
      async send() {
        return { delivered: false, expired: false };
      },
    };
  }

  webPush.setVapidDetails(subject, publicKey, privateKey);

  return {
    isConfigured: true,
    async send(subscription, payload) {
      try {
        await webPush.sendNotification(
          { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
          JSON.stringify(payload),
        );
        return { delivered: true, expired: false };
      } catch (err) {
        const expired = err instanceof WebPushError && (err.statusCode === 404 || err.statusCode === 410);
        if (!expired) {
          // A real, unexpected failure (bad payload, push service down) —
          // worth knowing about; still never thrown onward (service.ts's
          // docstring on why).
          console.error("push.send failed", err);
        }
        return { delivered: false, expired };
      }
    },
  };
}
