"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button, Placeholder, useAuthSession } from "@closebuy/ui";
import { ApiClientError } from "@closebuy/api-client";
import { formatNaira, minor } from "@closebuy/types";
import type { OrderSummaryDto, OrderStatus } from "@closebuy/types";
import { orderApi } from "@/lib/api";

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

/**
 * screens-navigation.md §1.8 — US-C-09. Signed-in only: a guest's order
 * history lives entirely in whatever tracking links they were given
 * (US-C-06a), there's no account to list against.
 */
export default function OrdersPage() {
  const router = useRouter();
  const { session, isLoaded } = useAuthSession();
  const [orders, setOrders] = useState<OrderSummaryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    orderApi
      .listMyOrders()
      .then((res) => setOrders(res.orders))
      .catch((err) => setError(err instanceof ApiClientError ? err.message : "Couldn't load your orders."));
  }, [session]);

  if (!isLoaded) return null;

  if (!session) {
    return (
      <div className="flex flex-col items-center gap-4 p-4 pt-16 text-center">
        <Placeholder
          title="Sign in to see your orders"
          note="A guest's order lives at the tracking link from checkout instead — nothing required to place it in the first place."
        />
        <Button onClick={() => router.push("/login")}>Sign in</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-lg font-bold text-ink">Your orders</h1>

      {error && <p className="text-sm text-danger">{error}</p>}

      {orders === null ? (
        <p className="py-8 text-center text-sm text-muted">Loading…</p>
      ) : orders.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <p className="text-sm text-muted">No orders yet.</p>
          <Link href="/">
            <Button>Browse vendors</Button>
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {orders.map((order) => (
            <Link
              key={order.id}
              href={`/orders/track/${order.trackingToken}`}
              className="flex items-center justify-between rounded-xl border border-gray-200 bg-white p-3 shadow-sm"
            >
              <div>
                <p className="text-sm font-medium text-ink">{STATUS_LABEL[order.status] ?? order.status}</p>
                <p className="text-xs text-muted">{new Date(order.createdAt).toLocaleDateString()}</p>
              </div>
              <p className="text-sm font-semibold text-ink">{formatNaira(minor(order.totalMinor))}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
