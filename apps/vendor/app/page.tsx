"use client";

import { useEffect, useRef, useState } from "react";
import { ApiClientError } from "@closebuy/api-client";
import type { OrderDto } from "@closebuy/types";
import { orderApi } from "@/lib/api";
import { VendorGate } from "@/components/VendorGate";
import { OrderCard } from "@/components/OrderCard";
import { PageHeader } from "@/components/PageHeader";
import { formatNaira, minor } from "@closebuy/types";
import type { OwnVendorProfileDto } from "@closebuy/types";

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
  return <VendorGate>{(vendor, refetch) => <OrdersQueue vendor={vendor} refetch={refetch} />}</VendorGate>;
}

function OrdersQueue({ vendor, refetch }: { vendor: OwnVendorProfileDto; refetch: () => void }) {
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
    { key: "new", label: "New" },
    { key: "inProgress", label: "In progress" },
    { key: "scheduled", label: "Scheduled" },
    { key: "history", label: "History" },
  ];
  const shown = buckets[tab];

  // "Today" is the vendor's own calendar day. Sales = goods value (subtotal) of today's orders that
  // weren't cancelled/refunded/abandoned — the delivery fee is the rider's, never the shop's.
  const todayStr = new Date().toDateString();
  const todaysSalesMinor = orders
    .filter((o) => new Date(o.createdAt).toDateString() === todayStr && !["PENDING_PAYMENT", "CANCELLED", "REFUNDED"].includes(o.status))
    .reduce((sum, o) => sum + o.subtotalMinor, 0);
  const kpis = [
    { label: "New", value: String(buckets.new.length), hot: buckets.new.length > 0 },
    { label: "In progress", value: String(buckets.inProgress.length) },
    { label: "Scheduled", value: String(buckets.scheduled.length) },
    { label: "Today · sales", value: formatNaira(minor(todaysSalesMinor)) },
  ];

  return (
    <div className="flex flex-col">
      <PageHeader title="Order queue" subtitle="Live · auto-refresh on" vendor={vendor} onVendorChanged={refetch} />

      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
          {kpis.map((k) => (
            <div key={k.label} className="flex flex-col gap-1 rounded-xl bg-card p-3.5 shadow-[inset_0_0_0_1px_rgb(var(--c-line))]">
              <span className="font-mono text-[10px] uppercase text-muted">{k.label}</span>
              <span className={`font-mono text-xl font-semibold ${k.hot ? "text-accent" : "text-ink"}`}>{k.value}</span>
            </div>
          ))}
        </div>

        <div role="tablist" className="flex gap-1 overflow-x-auto rounded-[11px] bg-card p-[3px] shadow-[inset_0_0_0_1px_rgb(var(--c-line))] [scrollbar-width:none]">
          {TABS.map((t) => {
            const n = buckets[t.key].length;
            const on = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setTab(t.key)}
                className={`flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 text-[13px] font-medium transition-colors ${
                  on ? "bg-primary text-white" : "text-ink hover:bg-raised"
                }`}
              >
                {t.label}
                {n > 0 && (
                  <span className={`rounded-md px-1.5 font-mono text-[10px] ${on ? "bg-white/20" : t.key === "new" ? "bg-accent text-night" : "bg-raised text-muted"}`}>{n}</span>
                )}
              </button>
            );
          })}
        </div>

        {shown.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted">Nothing here.</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {shown.map((order) => (
              <OrderCard key={order.id} order={order} onChanged={load} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
