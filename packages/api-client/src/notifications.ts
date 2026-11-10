import type { ApiClient } from "./client";
import type { NotificationDto, PushSubscribeInput } from "@closebuy/types";

export function createNotificationsApi(client: ApiClient) {
  return {
    /** In-app feed — any authenticated role, most-recent-first (api-contracts.md). */
    list: () => client.request<{ notifications: NotificationDto[] }>("/notifications"),

    markRead: (id: string) => client.request<void>(`/notifications/${id}/read`, { method: "POST" }),

    /** `publicKey` is null when the API has no VAPID keys — push is then simply unavailable and the toggle hides itself. */
    vapidKey: () => client.request<{ publicKey: string | null }>("/notifications/vapid-key"),

    /** Register this browser for push — pass a PushSubscription's `toJSON()` straight through. */
    subscribe: (subscription: PushSubscribeInput) =>
      client.request<void>("/notifications/subscribe", { method: "POST", body: JSON.stringify(subscription) }),

    unsubscribe: (endpoint: string) =>
      client.request<void>("/notifications/unsubscribe", { method: "POST", body: JSON.stringify({ endpoint }) }),
  };
}
