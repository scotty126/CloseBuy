"use client";

import { useEffect, useState } from "react";
import { ApiClientError } from "@closebuy/api-client";
import type { NotificationDto, NotificationType } from "@closebuy/types";
import { notificationsApi } from "@/lib/api";
import { VendorGate } from "@/components/VendorGate";

// Only the types a vendor session actually receives (notify() is
// per-user, not per-role, so this is defensive, not exhaustive) — a
// generic fallback covers anything unmapped so a future type never
// renders blank.
const LABELS: Partial<Record<NotificationType, string>> = {
  order_paid: "A new order needs accepting",
  vendor_application_approved: "Your vendor application was approved",
  vendor_application_rejected: "Your vendor application wasn't approved",
  payout_paid: "A payout was paid out",
  payout_failed: "A payout attempt failed",
  payout_rejected: "A payout request was rejected",
  vendor_suspended: "Your account was suspended",
  vendor_unsuspended: "Your account was reinstated",
  order_force_cancelled: "An order was cancelled by CloseBuy support",
  dispute_resolved: "A reported problem was resolved",
};

export default function NotificationsPage() {
  return <VendorGate>{() => <Notifications />}</VendorGate>;
}

function Notifications() {
  const [notifications, setNotifications] = useState<NotificationDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    notificationsApi
      .list()
      .then((res) => setNotifications(res.notifications))
      .catch((err) => setError(err instanceof ApiClientError ? err.message : "Couldn't load notifications."));
  }, []);

  async function markRead(id: string) {
    setNotifications((prev) => prev?.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)) ?? prev);
    try {
      await notificationsApi.markRead(id);
    } catch {
      // Best effort — worst case it just shows as unread again next load.
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-bold text-ink">Notifications</h1>

      {error && <p className="text-sm text-danger">{error}</p>}

      {notifications === null ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : notifications.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">No notifications yet.</p>
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
