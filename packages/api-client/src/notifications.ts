import type { ApiClient } from "./client";
import type { NotificationDto } from "@closebuy/types";

export function createNotificationsApi(client: ApiClient) {
  return {
    /** In-app feed — any authenticated role, most-recent-first (api-contracts.md). */
    list: () => client.request<{ notifications: NotificationDto[] }>("/notifications"),

    markRead: (id: string) => client.request<void>(`/notifications/${id}/read`, { method: "POST" }),
  };
}
