"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button, Placeholder, useAuthSession } from "@closebuy/ui";
import { ApiClientError } from "@closebuy/api-client";
import { ClipboardList, ChevronRight } from "lucide-react";
import { formatNaira, minor } from "@closebuy/types";
import type { OrderSummaryDto, OrderStatus } from "@closebuy/types";
import { orderApi } from "@/lib/api";
import { getGuestOrders } from "@/lib/guestOrders";

const STATUS_LABEL: Partial<Record<OrderStatus, string>> = {
  PENDING_PAYMENT: "Awaiting payment",
  PAID: "Order placed",
  PREPARING: "Preparing",
  READY_FOR_PICKUP: "Ready",
  RIDER_ASSIGNED: "Rider assigned",
  IN_TRANSIT: "On the way",
  DELIVERED: "Delivered",
  DELIVERY_FAILED: "Delivery failed",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
  COMPLETED: "Completed",
};

// Purely a visual grouping of the same OrderStatus enum — no new states,
// just which of the existing badge tokens (success/warning/danger) a
// status reads as "good", "in progress" or "stopped".
const STATUS_TONE: Partial<Record<OrderStatus, "success" | "warning" | "danger">> = {
  DELIVERED: "success",
  COMPLETED: "success",
  PREPARING: "warning",
  READY_FOR_PICKUP: "warning",
  RIDER_ASSIGNED: "warning",
  IN_TRANSIT: "warning",
  PENDING_PAYMENT: "warning",
  DELIVERY_FAILED: "danger",
  CANCELLED: "danger",
  REFUNDED: "danger",
};
const TONE_CLASSES: Record<"success" | "warning" | "danger", string> = {
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  danger: "bg-danger/10 text-danger",
};

/**
 * screens-navigation.md §1.8 — US-C-09. Signed-in customers list against
 * their account (GET /orders). A guest has no account to list against
 * server-side (US-C-06a) — there's no phone/email guaranteed unique or
 * verified enough to key a lookup on — but that used to mean this tab was
 * simply a dead end for them after checkout, even though they'd just placed
 * a real order seconds earlier. It now also reads back whatever tracking
 * tokens *this browser* remembers (lib/guestOrders.ts, written at the
 * moment checkout succeeds) and fetches each one's current status via the
 * same public trackingToken route the tracking page itself uses — same
 * device only, not a synced account, and said so on screen rather than
 * implied.
 */
export default function OrdersPage() {
  const router = useRouter();
  const { session, isLoaded } = useAuthSession();
  const [orders, setOrders] = useState<OrderSummaryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guestOrders, setGuestOrders] = useState<OrderSummaryDto[] | null>(null);

  useEffect(() => {
    if (!session) return;
    orderApi
      .listMyOrders()
      .then((res) => setOrders(res.orders))
      .catch((err) => setError(err instanceof ApiClientError ? err.message : "Couldn't load your orders."));
  }, [session]);

  useEffect(() => {
    if (!isLoaded || session) return;
    const refs = getGuestOrders();
    if (refs.length === 0) {
      setGuestOrders([]);
      return;
    }
    Promise.all(
      refs.map((ref) =>
        orderApi
          .getOrderByTrackingToken(ref.trackingToken)
          .then((res) => res.order)
          .catch(() => null), // one bad/pruned token shouldn't blank the whole list
      ),
    ).then((results) => {
      const found = results.filter((o): o is NonNullable<typeof o> => o !== null);
      found.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      setGuestOrders(found);
    });
  }, [isLoaded, session]);

  if (!isLoaded) return null;

  if (!session) {
    if (guestOrders === null) {
      return (
        <div className="flex flex-col gap-3 p-4">
          {[0, 1].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-2xl bg-surface" />
          ))}
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-4 p-4">
        <div>
          <h1 className="text-xl font-bold text-ink">Your orders</h1>
          <p className="text-xs text-muted">
            {guestOrders.length > 0
              ? "Remembered on this device only — a different phone or browser won't show these. Sign in for a permanent history instead."
              : "A guest order lives at the tracking link from checkout — nothing required to place it in the first place."}
          </p>
        </div>
        <Button variant="secondary" onClick={() => router.push("/login")}>
          Sign in for permanent history
        </Button>

        {guestOrders.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <Placeholder title="No orders on this device yet" note="Orders you place as a guest will show up here." />
            <Link href="/">
              <Button>Browse vendors</Button>
            </Link>
          </div>
        ) : (
          <OrderList orders={guestOrders} />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-xl font-bold text-ink">Your orders</h1>

      {error && <p className="text-sm text-danger">{error}</p>}

      {orders === null ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-2xl bg-surface" />
          ))}
        </div>
      ) : orders.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-14 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface text-muted">
            <ClipboardList size={22} />
          </span>
          <p className="text-sm font-medium text-ink">No orders yet</p>
          <Link href="/" className="mt-1">
            <Button>Browse vendors</Button>
          </Link>
        </div>
      ) : (
        <OrderList orders={orders} />
      )}
    </div>
  );
}

function OrderList({ orders }: { orders: OrderSummaryDto[] }) {
  return (
    <div className="flex flex-col gap-3">
      {orders.map((order) => {
        const tone = STATUS_TONE[order.status] ?? "warning";
        return (
          <Link
            key={order.id}
            href={`/orders/track/${order.trackingToken}`}
            className="flex items-center justify-between rounded-2xl border border-gray-200 bg-white p-4 shadow-sm active:bg-surface"
          >
            <div className="flex flex-col gap-1">
              <span className={`w-fit rounded-full px-2.5 py-0.5 text-[11px] font-bold ${TONE_CLASSES[tone]}`}>
                {STATUS_LABEL[order.status] ?? order.status}
              </span>
              <p className="text-xs text-muted">{new Date(order.createdAt).toLocaleDateString()}</p>
            </div>
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-bold text-ink">{formatNaira(minor(order.totalMinor))}</p>
              <ChevronRight size={16} className="text-muted" />
            </div>
          </Link>
        );
      })}
    </div>
  );
}
