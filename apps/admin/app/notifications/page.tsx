"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthSession } from "@closebuy/ui";
import { ApiClientError } from "@closebuy/api-client";
import type { NotificationDto, NotificationType } from "@closebuy/types";
import { notificationsApi } from "@/lib/api";

// Only the type an admin session actually receives today
// (`notifyAllAdmins`, dispatch/service.ts) — a generic fallback covers
// anything unmapped so a future broadcast type never renders blank.
const LABELS: Partial<Record<NotificationType, string>> = {
  order_delivery_failed: "A delivery failed — needs a look",
};

export default function NotificationsPage() {
  const router = useRouter();
  const { session, isLoaded } = useAuthSession();

  useEffect(() => {
    if (isLoaded && !session) router.push("/login");
  }, [isLoaded, session, router]);

  const [notifications, setNotifications] = useState<NotificationDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    notificationsApi
      .list()
      .then((res) => setNotifications(res.notifications))
      .catch((err) => setError(err instanceof ApiClientError ? err.message : "Couldn't load notifications."));
  }, [session]);

  async function markRead(id: string) {
    setNotifications((prev) => prev?.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)) ?? prev);
    try {
      await notificationsApi.markRead(id);
    } catch {
      // Best effort — worst case it just shows as unread again next load.
    }
  }

  if (!isLoaded || !session) return null;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold text-ink">Notifications</h1>
        <p className="text-sm text-muted">Broadcast alerts every admin receives — currently just failed deliveries (US-R-06).</p>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      {notifications === null ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : notifications.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-6 text-center">
          <p className="text-sm text-muted">No notifications yet.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {notifications.map((n) => {
            const unread = !n.readAt;
            return (
              <button
                key={n.id}
                type="button"
                onClick={() => unread && markRead(n.id)}
                className={`flex items-start gap-3 rounded-xl border p-3 text-left shadow-sm transition ${
                  unread ? "border-primary/20 bg-primary/5" : "border-gray-200 bg-white"
                }`}
              >
                {unread && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />}
                <div className="flex flex-col gap-0.5">
                  <p className={`text-sm ${unread ? "font-bold text-ink" : "font-medium text-ink"}`}>
                    {LABELS[n.type] ?? "You have an update"}
                  </p>
                  <p className="text-xs text-muted">{new Date(n.sentAt).toLocaleString()}</p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
