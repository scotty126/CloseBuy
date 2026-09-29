"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, Placeholder, useAuthSession } from "@closebuy/ui";
import { ApiClientError } from "@closebuy/api-client";
import { Bell } from "lucide-react";
import type { NotificationDto, NotificationType } from "@closebuy/types";
import { notificationsApi } from "@/lib/api";

// Only the types a customer session actually receives (notify() is
// per-user, not per-role, so this is defensive, not exhaustive) — anything
// else falls back to a generic label rather than rendering blank, since a
// new NotificationType never needs this file updated to stay safe.
const LABELS: Partial<Record<NotificationType, string>> = {
  order_accepted: "Your order was accepted",
  order_rejected: "Your order was rejected",
  order_ready_for_pickup: "Your order is ready",
  order_rider_assigned: "A rider was assigned to your order",
  order_in_transit: "Your order is on the way",
  order_delivered: "Your order was delivered",
  order_delivery_failed: "Delivery couldn't be completed",
  order_auto_rejected: "The vendor didn't respond in time — your order was cancelled",
  order_payment_expired: "Your payment wasn't completed in time — the order was cancelled",
  order_force_cancelled: "Your order was cancelled by CloseBuy support",
  order_force_refunded: "Your order was refunded by CloseBuy support",
  dispute_resolved: "Your reported problem was resolved",
};

/**
 * US-notifications — the in-app feed for `notify()`, which has fired into
 * a real `Notification` row since early in this build with zero frontend
 * consumer anywhere. Informational-only: `payload` carries a raw
 * `orderId`, not a `trackingToken`, and this app has no raw-orderId route,
 * so there's deliberately no "view order" link here yet.
 */
export default function NotificationsPage() {
  const { session, isLoaded } = useAuthSession();
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

  if (!isLoaded) return null;

  if (!session) {
    return (
      <div className="flex flex-col items-center gap-3 p-4 py-14 text-center">
        <Placeholder title="Sign in to see notifications" note="Updates about your orders show up here once you're signed in." />
        <Link href="/login">
          <Button>Sign in</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-xl font-bold text-ink">Notifications</h1>

      {error && <p className="text-sm text-danger">{error}</p>}

      {notifications === null ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-2xl bg-surface" />
          ))}
        </div>
      ) : notifications.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-14 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface text-muted">
            <Bell size={22} />
          </span>
          <p className="text-sm font-medium text-ink">No notifications yet</p>
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
                className={`flex items-start gap-3 rounded-2xl border p-4 text-left shadow-sm transition ${
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
