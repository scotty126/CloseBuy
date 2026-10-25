"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ApiClientError } from "@closebuy/api-client";
import { Store } from "lucide-react";
import { ThemeToggle, useAuthSession } from "@closebuy/ui";
import { formatNaira, minor } from "@closebuy/types";
import type { OrderStatus, OrderSummaryDto } from "@closebuy/types";
import { orderApi } from "@/lib/api";
import { getGuestOrders } from "@/lib/guestOrders";
import { useReorder } from "@/lib/useReorder";
import { MonoArrow } from "@/components/MonoArrow";
import { tileFor } from "@/components/DealCard";

const STATUS_LABEL: Partial<Record<OrderStatus, string>> = {
  PENDING_PAYMENT: "Awaiting payment",
  PAID: "Order placed",
  PREPARING: "Being packed",
  READY_FOR_PICKUP: "Ready",
  RIDER_ASSIGNED: "Rider assigned",
  IN_TRANSIT: "On the way",
  DELIVERED: "Delivered",
  DELIVERY_FAILED: "Delivery failed",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
  COMPLETED: "Completed",
};

const ACTIVE: OrderStatus[] = ["PENDING_PAYMENT", "PAID", "PREPARING", "READY_FOR_PICKUP", "RIDER_ASSIGNED", "IN_TRANSIT"];
const MOVING: OrderStatus[] = ["RIDER_ASSIGNED", "IN_TRANSIT"];
const PAST_TONE: Partial<Record<OrderStatus, string>> = {
  DELIVERED: "text-success",
  COMPLETED: "text-success",
  DELIVERY_FAILED: "text-danger",
  CANCELLED: "text-danger",
  REFUNDED: "text-danger",
};

function segmentOf(status: OrderStatus): number {
  if (status === "PAID" || status === "PENDING_PAYMENT") return 0;
  if (status === "PREPARING" || status === "READY_FOR_PICKUP") return 1;
  if (MOVING.includes(status)) return 2;
  return 3;
}

const ACTIVE_NOTE: Partial<Record<OrderStatus, string>> = {
  PENDING_PAYMENT: "Waiting for your payment to be confirmed.",
  PAID: "Waiting for the shop to accept your order.",
  PREPARING: "The shop is packing your order. A rider will be assigned soon.",
  READY_FOR_PICKUP: "Packed and ready. A rider will pick it up shortly.",
};

const itemsText = (o: OrderSummaryDto) => (o.itemCount != null ? `${o.itemCount} item${o.itemCount === 1 ? "" : "s"}` : "");

/**
 * screens-navigation.md §1.8 — US-C-09. Signed-in customers list against
 * their account (GET /orders). A guest has no account to list against
 * server-side (US-C-06a) — there's no phone/email guaranteed unique or
 * verified enough to key a lookup on — so it reads back whatever tracking
 * tokens *this browser* remembers (lib/guestOrders.ts, written at the moment
 * checkout succeeds) and fetches each one's current status via the same
 * public trackingToken route the tracking page itself uses — same device
 * only, not a synced account, and said so on screen rather than implied.
 */
export default function OrdersPage() {
  const { session, isLoaded } = useAuthSession();
  const reorder = useReorder();
  const [tab, setTab] = useState<"active" | "past">("active");
  const [orders, setOrders] = useState<OrderSummaryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reorderingToken, setReorderingToken] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoaded) return;
    if (session) {
      orderApi
        .listMyOrders()
        .then((res) => setOrders(res.orders))
        .catch((err) => {
          setOrders([]);
          setError(err instanceof ApiClientError ? err.message : "Couldn't load your orders.");
        });
      return;
    }
    const refs = getGuestOrders();
    if (refs.length === 0) {
      setOrders([]);
      return;
    }
    Promise.all(
      refs.map((ref) =>
        orderApi
          .getOrderByTrackingToken(ref.trackingToken)
          .then((res) => ({ ...res.order, itemCount: res.order.items.reduce((n, i) => n + i.quantity, 0) }) as OrderSummaryDto)
          .catch(() => null), // one bad/pruned token shouldn't blank the whole list
      ),
    ).then((results) => {
      const found = results.filter((o): o is OrderSummaryDto => o !== null);
      found.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      setOrders(found);
    });
  }, [isLoaded, session]);

  async function handleReorder(token: string) {
    setReorderingToken(token);
    try {
      const { order } = await orderApi.getOrderByTrackingToken(token);
      await reorder.reorder(order);
    } finally {
      setReorderingToken(null);
    }
  }

  if (!isLoaded) return null;

  const active = (orders ?? []).filter((o) => ACTIVE.includes(o.status));
  const past = (orders ?? []).filter((o) => !ACTIVE.includes(o.status));
  const shown = tab === "active" ? active : past;

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-3.5 px-4 pb-3 pt-[18px]">
        <div className="flex items-center justify-between">
          <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-ink">My orders</h1>
          <ThemeToggle />
        </div>
        <div role="tablist" className="grid grid-cols-2 rounded-2xl bg-card p-1">
          {(["active", "past"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`h-11 rounded-xl text-[15px] font-bold transition-colors ${tab === t ? "bg-accent text-[#10231C]" : "text-ink"}`}
            >
              {t === "active" ? `Active${active.length > 0 ? ` (${active.length})` : ""}` : "Past"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3 px-4 pb-6 pt-1">
        {!session && (
          <div className="flex flex-col gap-1 rounded-[14px] bg-raised p-3.5 text-[13px] leading-snug text-ink">
            <span>
              {orders && orders.length > 0
                ? "Remembered on this device only — a different phone or browser won't show these."
                : "Guest orders are remembered on this device only."}{" "}
              <Link href="/login" className="font-semibold underline">
                Sign in
              </Link>{" "}
              for a permanent history.
            </span>
          </div>
        )}

        {error && <p className="text-sm text-danger">{error}</p>}
        {reorder.error && <p className="text-sm text-danger">{reorder.error}</p>}

        {orders === null ? (
          <div className="flex flex-col gap-3">
            {[0, 1].map((i) => (
              <div key={i} className="h-28 animate-pulse rounded-[14px] bg-raised" />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-raised text-muted">
              <Store size={22} />
            </span>
            <p className="text-sm font-medium text-ink">{tab === "active" ? "Nothing on the way" : "No past orders yet"}</p>
            <Link href="/" className="text-[13px] font-semibold text-primary underline dark:text-[#8FD1B5]">
              Browse shops near you
            </Link>
          </div>
        ) : tab === "active" ? (
          shown.map((o) =>
            MOVING.includes(o.status) ? (
              <Link key={o.id} href={`/orders/track/${o.trackingToken}`} className="flex flex-col gap-3 rounded-[14px] bg-primary p-4 text-[#FFF7F1]">
                <span className="flex items-center justify-between">
                  <span className="rounded-full bg-accent px-2.5 py-[5px] text-xs font-bold text-[#10231C]">{STATUS_LABEL[o.status]}</span>
                  <span className="text-xs opacity-85">#{o.id.slice(0, 4).toUpperCase()}</span>
                </span>
                <span className="text-xl font-semibold">{o.vendor?.businessName ?? "Your order"}</span>
                <span className="flex gap-1">
                  {[0, 1, 2, 3].map((i) => (
                    <span key={i} className={`h-[5px] flex-1 rounded-[3px] ${i < segmentOf(o.status) ? "bg-[#FFF7F1]" : i === segmentOf(o.status) ? "bg-accent" : "bg-[#FFF7F1]/25"}`} />
                  ))}
                </span>
                <span className="flex justify-between text-[13px]">
                  <span>{[itemsText(o), formatNaira(minor(o.totalMinor))].filter(Boolean).join(" · ")}</span>
                  <span className="flex items-center gap-1 font-bold">
                    Track <MonoArrow size={12} />
                  </span>
                </span>
              </Link>
            ) : (
              <Link key={o.id} href={`/orders/track/${o.trackingToken}`} className="flex flex-col gap-2.5 rounded-[14px] bg-card p-4">
                <span className="flex items-center justify-between">
                  <span className="rounded-full bg-raised px-2.5 py-[5px] text-xs font-bold text-ink">{STATUS_LABEL[o.status] ?? o.status}</span>
                  <span className="text-xs text-muted">#{o.id.slice(0, 4).toUpperCase()}</span>
                </span>
                <span className="font-bold text-ink">{[o.vendor?.businessName ?? "Your order", itemsText(o)].filter(Boolean).join(" · ")}</span>
                <span className="text-[13px] text-muted">{ACTIVE_NOTE[o.status] ?? `${formatNaira(minor(o.totalMinor))} · placed ${new Date(o.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`}</span>
              </Link>
            ),
          )
        ) : (
          shown.map((o) => (
            <div key={o.id} className="flex flex-col gap-3 rounded-[14px] bg-card p-3.5">
              <Link href={`/orders/track/${o.trackingToken}`} className="flex items-center gap-3">
                <span className={`flex h-[46px] w-[46px] shrink-0 items-center justify-center overflow-hidden rounded-[14px] text-[#10231C] ${tileFor(o.vendorId)}`}>
                  {o.vendor?.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- external, vendor-supplied URL
                    <img src={o.vendor.logoUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <Store size={22} strokeWidth={1.8} />
                  )}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate font-bold text-ink">{o.vendor?.businessName ?? "Your order"}</span>
                  <span className="text-xs text-muted">
                    {new Date(o.createdAt).toLocaleDateString()}
                    {itemsText(o) && ` · ${itemsText(o)}`} · <span className={PAST_TONE[o.status] ?? ""}>{STATUS_LABEL[o.status] ?? o.status}</span>
                  </span>
                </span>
                <span className="font-semibold text-ink">{formatNaira(minor(o.totalMinor))}</span>
              </Link>
              <div className="flex gap-2">
                {(o.status === "COMPLETED" || o.status === "DELIVERED") && (
                  <Link
                    href={`/orders/track/${o.trackingToken}#rate`}
                    className="flex h-11 flex-1 items-center justify-center rounded-[14px] bg-raised text-sm font-bold text-ink"
                  >
                    {o.status === "COMPLETED" ? "Rate" : "View"}
                  </Link>
                )}
                <button
                  type="button"
                  onClick={() => handleReorder(o.trackingToken)}
                  disabled={reorderingToken === o.trackingToken}
                  className="flex h-11 flex-1 items-center justify-center rounded-[14px] bg-accent text-sm font-bold text-[#10231C] disabled:opacity-60"
                >
                  {reorderingToken === o.trackingToken ? "Reordering…" : "Reorder"}
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {reorder.dialog}
    </div>
  );
}
