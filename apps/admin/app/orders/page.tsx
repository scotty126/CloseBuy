"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, StatusBadge, useAuthSession } from "@closebuy/ui";
import { ApiClientError } from "@closebuy/api-client";
import { formatNaira, minor, ORDER_STATUSES, FULFILMENT_TYPES } from "@closebuy/types";
import type { AdminOrderSummaryDto, OrderStatus, FulfilmentType } from "@closebuy/types";
import { adminApi } from "@/lib/api";

/** screens-navigation.md §4.2 — US-A-03. Full list, filterable by state/vendor/rider/date/fulfilment type, drill into any order's complete history. */
export default function OrdersPage() {
  const router = useRouter();
  const { session, isLoaded } = useAuthSession();

  const [orders, setOrders] = useState<AdminOrderSummaryDto[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const [status, setStatus] = useState<OrderStatus | "">("");
  const [fulfilmentType, setFulfilmentType] = useState<FulfilmentType | "">("");

  useEffect(() => {
    if (isLoaded && !session) router.push("/login");
  }, [isLoaded, session, router]);

  useEffect(() => {
    if (!session) return;
    setOrders(null);
    setLoadError(null);
    adminApi
      .listOrders({ status: status || undefined, fulfilmentType: fulfilmentType || undefined })
      .then((res) => {
        setOrders(res.orders);
        setNextCursor(res.nextCursor);
      })
      .catch((err) => setLoadError(err instanceof ApiClientError ? err.message : "Couldn't load orders."));
  }, [session, status, fulfilmentType]);

  async function loadMore() {
    if (!nextCursor) return;
    setIsLoadingMore(true);
    try {
      const res = await adminApi.listOrders({ status: status || undefined, fulfilmentType: fulfilmentType || undefined, cursor: nextCursor });
      setOrders((prev) => [...(prev ?? []), ...res.orders]);
      setNextCursor(res.nextCursor);
    } catch (err) {
      setLoadError(err instanceof ApiClientError ? err.message : "Couldn't load more orders.");
    } finally {
      setIsLoadingMore(false);
    }
  }

  if (!isLoaded || !session) return null;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold text-ink">Orders</h1>
        <p className="text-sm text-muted">Every order on the platform. Open one to see its full history and step in if something's stalled (US-A-03).</p>
      </div>

      <div className="flex gap-3">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as OrderStatus | "")}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">All statuses</option>
          {ORDER_STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select
          value={fulfilmentType}
          onChange={(e) => setFulfilmentType(e.target.value as FulfilmentType | "")}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">Delivery + pickup</option>
          {FULFILMENT_TYPES.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
      </div>

      {loadError && <p className="text-sm text-danger">{loadError}</p>}

      {orders === null && !loadError ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : orders && orders.length === 0 ? (
        <Card><p className="text-sm text-muted">No orders match this filter.</p></Card>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 bg-surface text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-2">Order</th>
                <th className="px-4 py-2">Vendor</th>
                <th className="px-4 py-2">Rider</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Fulfilment</th>
                <th className="px-4 py-2">Total</th>
                <th className="px-4 py-2">Placed</th>
              </tr>
            </thead>
            <tbody>
              {orders?.map((order) => (
                <tr key={order.id} className="border-b border-gray-100 last:border-0 hover:bg-surface">
                  <td className="px-4 py-2">
                    <Link href={`/orders/${order.id}`} className="font-medium text-primary underline">
                      {order.id.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-ink">{order.vendor.businessName}</td>
                  <td className="px-4 py-2 text-ink">{order.rider?.fullName ?? "—"}</td>
                  <td className="px-4 py-2"><StatusBadge status={order.status} /></td>
                  <td className="px-4 py-2 text-ink">{order.fulfilmentType}</td>
                  <td className="px-4 py-2 text-ink">{formatNaira(minor(order.totalMinor))}</td>
                  <td className="px-4 py-2 text-muted">{new Date(order.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {nextCursor && (
        <button
          type="button"
          onClick={loadMore}
          disabled={isLoadingMore}
          className="self-start text-sm font-medium text-primary underline disabled:opacity-50"
        >
          {isLoadingMore ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
