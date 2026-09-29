"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, Input, StatusBadge, useAuthSession } from "@closebuy/ui";
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
  // Applied only on explicit submit (below), not live per keystroke —
  // status/fulfilmentType are selects so instant reactivity there is
  // cheap; vendorId/riderId are free text and from/to are dates, same
  // "explicit Search" convention the audit-log page already uses for its
  // own free-text filters.
  const [vendorIdInput, setVendorIdInput] = useState("");
  const [riderIdInput, setRiderIdInput] = useState("");
  const [fromInput, setFromInput] = useState("");
  const [toInput, setToInput] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [riderId, setRiderId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  useEffect(() => {
    if (isLoaded && !session) router.push("/login");
  }, [isLoaded, session, router]);

  function applyFilters(e?: React.FormEvent) {
    e?.preventDefault();
    setVendorId(vendorIdInput.trim());
    setRiderId(riderIdInput.trim());
    setFrom(fromInput);
    setTo(toInput);
  }

  // Plain calendar dates in the UI, widened to the full local-day boundary —
  // adminOrderFilterSchema wants a full ISO datetime, same convention as
  // the audit-log page's own date filter.
  function filterArgs(extra?: { cursor?: string }) {
    return {
      status: status || undefined,
      fulfilmentType: fulfilmentType || undefined,
      vendorId: vendorId || undefined,
      riderId: riderId || undefined,
      from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
      to: to ? new Date(`${to}T23:59:59.999`).toISOString() : undefined,
      ...extra,
    };
  }

  useEffect(() => {
    if (!session) return;
    setOrders(null);
    setLoadError(null);
    adminApi
      .listOrders(filterArgs())
      .then((res) => {
        setOrders(res.orders);
        setNextCursor(res.nextCursor);
      })
      .catch((err) => setLoadError(err instanceof ApiClientError ? err.message : "Couldn't load orders."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, status, fulfilmentType, vendorId, riderId, from, to]);

  async function loadMore() {
    if (!nextCursor) return;
    setIsLoadingMore(true);
    try {
      const res = await adminApi.listOrders(filterArgs({ cursor: nextCursor }));
      setOrders((prev) => [...(prev ?? []), ...res.orders]);
      setNextCursor(res.nextCursor);
    } catch (err) {
      setLoadError(err instanceof ApiClientError ? err.message : "Couldn't load more orders.");
    } finally {
      setIsLoadingMore(false);
    }
  }

  function filterByVendor(id: string) {
    setVendorIdInput(id);
    setVendorId(id);
  }
  function filterByRider(id: string) {
    setRiderIdInput(id);
    setRiderId(id);
  }

  if (!isLoaded || !session) return null;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold text-ink">Orders</h1>
        <p className="text-sm text-muted">Every order on the platform. Open one to see its full history and step in if something&apos;s stalled (US-A-03).</p>
      </div>

      <div className="flex flex-wrap gap-3">
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

      <form onSubmit={applyFilters} className="flex flex-wrap items-end gap-3">
        <Input label="Vendor ID" value={vendorIdInput} onChange={(e) => setVendorIdInput(e.target.value)} placeholder="vendor uuid" />
        <Input label="Rider ID" value={riderIdInput} onChange={(e) => setRiderIdInput(e.target.value)} placeholder="rider uuid" />
        <Input label="From" type="date" value={fromInput} onChange={(e) => setFromInput(e.target.value)} max={toInput || undefined} />
        <Input label="To" type="date" value={toInput} onChange={(e) => setToInput(e.target.value)} min={fromInput || undefined} />
        <button type="submit" className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white">
          Search
        </button>
        {(vendorId || riderId || from || to) && (
          <button
            type="button"
            onClick={() => {
              setVendorIdInput("");
              setRiderIdInput("");
              setFromInput("");
              setToInput("");
              setVendorId("");
              setRiderId("");
              setFrom("");
              setTo("");
            }}
            className="text-sm font-medium text-muted underline"
          >
            Clear
          </button>
        )}
      </form>

      {loadError && <p className="text-sm text-danger">{loadError}</p>}

      {orders === null && !loadError ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : orders && orders.length === 0 ? (
        <Card><p className="text-sm text-muted">No orders match this filter.</p></Card>
      ) : (
        // Scrolls sideways inside its own card on a phone rather than clipping columns (or stretching the page).
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full min-w-[44rem] text-left text-sm">
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
                  <td className="px-4 py-2 text-ink">
                    <button type="button" onClick={() => filterByVendor(order.vendorId)} className="underline decoration-dotted">
                      {order.vendor.businessName}
                    </button>
                  </td>
                  <td className="px-4 py-2 text-ink">
                    {order.rider ? (
                      <button type="button" onClick={() => filterByRider(order.riderId!)} className="underline decoration-dotted">
                        {order.rider.fullName}
                      </button>
                    ) : (
                      "—"
                    )}
                  </td>
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
