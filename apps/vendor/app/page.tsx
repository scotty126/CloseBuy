"use client";

import { useEffect, useRef, useState } from "react";
import { ApiClientError } from "@closebuy/api-client";
import type { OrderDto } from "@closebuy/types";
import { orderApi } from "@/lib/api";
import { VendorGate } from "@/components/VendorGate";
import { OrderCard } from "@/components/OrderCard";

type Tab = "new" | "inProgress" | "scheduled" | "history";

const TERMINAL = ["DELIVERED", "COMPLETED", "CANCELLED", "REFUNDED", "DELIVERY_FAILED"];

function bucketOf(order: OrderDto): Tab {
  if (TERMINAL.includes(order.status)) return "history";
  if (order.scheduledFor) return "scheduled";
  if (order.status === "PAID") return "new";
  return "inProgress"; // PREPARING, READY_FOR_PICKUP, RIDER_ASSIGNED, IN_TRANSIT
}

/** US-V-05's "audible/visible alert" for a new order — a short beep via the Web Audio API, no asset file needed. Silently no-ops if audio isn't available (autoplay policy, unsupported); the tab's count badge is the fallback. */
function playNewOrderBeep() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.2);
  } catch {
    // Autoplay-restricted or unsupported — the visual badge still works.
  }
}

/** screens-navigation.md §2.1 — the default landing screen. */
export default function OrdersPage() {
  return <VendorGate>{() => <OrdersQueue />}</VendorGate>;
}

function OrdersQueue() {
  const [orders, setOrders] = useState<OrderDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("new");
  const previousNewCount = useRef<number | null>(null);

  function load() {
    orderApi
      .listVendorOrders()
      .then((res) => {
        const newCount = res.orders.filter((o) => bucketOf(o) === "new").length;
        if (previousNewCount.current !== null && newCount > previousNewCount.current) playNewOrderBeep();
        previousNewCount.current = newCount;
        setOrders(res.orders);
      })
      .catch((err) => setError(err instanceof ApiClientError ? err.message : "Couldn't load orders."));
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 8000); // a new order should surface without a manual refresh (US-V-05)
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <div className="p-4">
        <p className="text-sm text-danger">{error}</p>
      </div>
    );
  }
  if (orders === null) {
    return (
      <div className="p-4">
        <p className="text-sm text-muted">Loading…</p>
      </div>
    );
  }

  const buckets: Record<Tab, OrderDto[]> = { new: [], inProgress: [], scheduled: [], history: [] };
  for (const order of orders) buckets[bucketOf(order)].push(order);
  buckets.scheduled.sort((a, b) => new Date(a.scheduledFor!).getTime() - new Date(b.scheduledFor!).getTime());
  buckets.history.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  const TABS: Array<{ key: Tab; label: string }> = [
    { key: "new", label: buckets.new.length ? `New (${buckets.new.length})` : "New" },
    { key: "inProgress", label: "In progress" },
    { key: "scheduled", label: "Scheduled" },
    { key: "history", label: "History" },
  ];
  const shown = buckets[tab];

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-lg font-bold text-ink">Orders</h1>

      <div className="flex gap-1 overflow-x-auto rounded-lg bg-surface p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition ${
              tab === t.key ? "bg-white text-ink shadow-sm" : "text-muted"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">Nothing here.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {shown.map((order) => (
            <OrderCard key={order.id} order={order} onChanged={load} />
          ))}
        </div>
      )}
    </div>
  );
}
