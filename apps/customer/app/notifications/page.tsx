"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiClientError } from "@closebuy/api-client";
import { ArrowLeft, Bell, Check, CreditCard, ShieldCheck, Tag, Truck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAuthSession } from "@closebuy/ui";
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
  order_auto_rejected: "The shop didn't respond in time — your order was cancelled",
  order_payment_expired: "Your payment wasn't completed in time — the order was cancelled",
  order_force_cancelled: "Your order was cancelled by CloseBuy support",
  order_force_refunded: "Your order was refunded by CloseBuy support",
  dispute_resolved: "Your reported problem was resolved",
};

// One-line explanation under each title, and the tile each type wears (icon + tint), as in the canvas.
const BODY: Partial<Record<NotificationType, string>> = {
  order_accepted: "The shop is packing your order.",
  order_rejected: "You have been refunded in full.",
  order_ready_for_pickup: "Head to the shop to collect it.",
  order_rider_assigned: "They are on their way to the shop.",
  order_in_transit: "Open Orders to follow it.",
  order_delivered: "Enjoy! You can rate it from Orders.",
  order_delivery_failed: "We are sorting it out with the shop.",
  order_auto_rejected: "You have not been charged.",
  order_payment_expired: "Nothing was charged.",
  order_force_cancelled: "Any payment is being refunded.",
  order_force_refunded: "The money is on its way back to you.",
  dispute_resolved: "Open Orders to see the outcome.",
};
const TILE: Partial<Record<NotificationType, { icon: LucideIcon; tint: string }>> = {
  order_accepted: { icon: Check, tint: "bg-tile1" },
  order_delivered: { icon: Check, tint: "bg-tile1" },
  order_in_transit: { icon: Truck, tint: "bg-tile0" },
  order_rider_assigned: { icon: Truck, tint: "bg-tile0" },
  order_ready_for_pickup: { icon: Tag, tint: "bg-tile2" },
  order_force_refunded: { icon: CreditCard, tint: "bg-tile3" },
  dispute_resolved: { icon: ShieldCheck, tint: "bg-tile4" },
};

type Filter = "all" | "orders" | "account";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "orders", label: "Orders" },
  { id: "account", label: "Account" },
];
const kindOf = (t: NotificationType): Exclude<Filter, "all"> => (t.startsWith("order_") ? "orders" : "account");

function groupOf(iso: string): "Today" | "Earlier" {
  return new Date(iso).toDateString() === new Date().toDateString() ? "Today" : "Earlier";
}

function ago(iso: string): string {
  const mins = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
}

/**
 * The in-app feed for `notify()`. Informational-only: `payload` carries a raw
 * `orderId`, not a `trackingToken`, and this app has no raw-orderId route, so
 * there's deliberately no "view order" link on each row. There is no "Deals"
 * tab either — CloseBuy sends no marketing notifications to filter by.
 */
export default function NotificationsPage() {
  const router = useRouter();
  const { session, isLoaded } = useAuthSession();
  const [notifications, setNotifications] = useState<NotificationDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    if (!session) return;
    notificationsApi
      .list()
      .then((res) => setNotifications(res.notifications))
      .catch((err) => {
        setNotifications([]);
        setError(err instanceof ApiClientError ? err.message : "Couldn't load notifications.");
      });
  }, [session]);

  async function markRead(ids: string[]) {
    const now = new Date().toISOString();
    setNotifications((prev) => prev?.map((n) => (ids.includes(n.id) ? { ...n, readAt: now } : n)) ?? prev);
    // Best effort — worst case a row shows as unread again next load.
    await Promise.all(ids.map((id) => notificationsApi.markRead(id).catch(() => {})));
  }

  if (!isLoaded) return null;

  const unread = notifications?.filter((n) => !n.readAt) ?? [];
  const shown = (notifications ?? []).filter((n) => filter === "all" || kindOf(n.type) === filter);
  const groups = (["Today", "Earlier"] as const)
    .map((g) => ({ label: g, items: shown.filter((n) => groupOf(n.sentAt) === g) }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="flex flex-col">
      <header className="flex items-center gap-1.5 border-b border-line p-2">
        <button type="button" onClick={() => (window.history.length > 1 ? router.back() : router.push("/"))} aria-label="Back" className="flex h-11 w-11 items-center justify-center text-ink">
          <ArrowLeft size={18} strokeWidth={2} />
        </button>
        <div className="flex flex-1 flex-col">
          <h1 className="text-[17px] font-semibold tracking-[-0.02em] text-ink">Notifications</h1>
          {session && <span className="font-mono text-[11px] uppercase text-muted">{unread.length} unread</span>}
        </div>
        {unread.length > 0 && (
          <button type="button" onClick={() => markRead(unread.map((n) => n.id))} className="h-11 px-2.5 text-[13px] font-medium text-ink">
            Mark all read
          </button>
        )}
      </header>

      {!session ? (
        <div className="flex flex-col items-center gap-3 px-4 py-14 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-raised text-muted">
            <Bell size={22} />
          </span>
          <p className="text-sm font-medium text-ink">Sign in to see notifications</p>
          <p className="text-xs text-muted">Updates about your orders show up here once you&apos;re signed in.</p>
          <Link href="/login" className="flex h-11 items-center rounded-xl bg-accent px-5 text-sm font-semibold text-night">
            Sign in
          </Link>
        </div>
      ) : (
        <>
          <div role="tablist" className="flex gap-1.5 px-3.5 pb-1.5 pt-3">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={`flex h-[34px] items-center rounded-[9px] px-3 text-[13px] shadow-[inset_0_0_0_1px_rgb(var(--c-line))] ${
                  filter === f.id ? "bg-ink text-surface shadow-[inset_0_0_0_1px_rgb(var(--c-ink))]" : "bg-card text-ink"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-3.5 px-3.5 pb-6 pt-2">
            {error && <p className="text-sm text-danger">{error}</p>}
            {notifications === null ? (
              <div className="flex flex-col gap-3">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-16 animate-pulse rounded-[14px] bg-raised" />
                ))}
              </div>
            ) : groups.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-14 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-raised text-muted">
                  <Bell size={22} />
                </span>
                <p className="text-sm font-medium text-ink">No notifications yet</p>
              </div>
            ) : (
              groups.map((g) => (
                <div key={g.label} className="flex flex-col gap-1.5">
                  <span className="font-mono text-[11px] uppercase text-muted">{g.label}</span>
                  <div className="overflow-hidden rounded-[14px] bg-card shadow-[inset_0_0_0_1px_rgb(var(--c-line))]">
                    {g.items.map((n) => {
                      const isUnread = !n.readAt;
                      const tile = TILE[n.type] ?? (kindOf(n.type) === "orders" ? { icon: Truck, tint: "bg-tile0" } : { icon: ShieldCheck, tint: "bg-tile4" });
                      const Icon = tile.icon;
                      return (
                        <button
                          key={n.id}
                          type="button"
                          onClick={() => isUnread && markRead([n.id])}
                          className="flex w-full gap-3 border-b border-line px-3.5 py-3 text-left last:border-b-0"
                        >
                          <span className={`flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[9px] text-[#0E1F19] ${tile.tint}`}>
                            <Icon size={16} strokeWidth={1.8} aria-hidden="true" />
                          </span>
                          <span className="flex flex-1 flex-col gap-0.5">
                            <span className={`text-sm text-ink ${isUnread ? "font-semibold" : "font-normal"}`}>{LABELS[n.type] ?? "You have an update"}</span>
                            {BODY[n.type] && <span className="text-[13px] leading-[1.45] text-muted">{BODY[n.type]}</span>}
                          </span>
                          <span className="flex flex-col items-end gap-1.5">
                            <span className="font-mono text-[10px] uppercase text-muted">{ago(n.sentAt)}</span>
                            {isUnread && <span className="h-[7px] w-[7px] rounded-full bg-accent" aria-label="Unread" />}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
