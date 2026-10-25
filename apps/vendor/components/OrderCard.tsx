"use client";

import { useState } from "react";
import { Input } from "@closebuy/ui";
import { ApiClientError } from "@closebuy/api-client";
import { formatNaira, minor } from "@closebuy/types";
import type { OrderDto } from "@closebuy/types";
import { orderApi } from "@/lib/api";

const STATUS_LABEL: Record<string, string> = {
  PENDING_PAYMENT: "Awaiting payment",
  PAID: "New order",
  PREPARING: "Preparing",
  READY_FOR_PICKUP: "Ready",
  RIDER_ASSIGNED: "Rider assigned",
  IN_TRANSIT: "Out for delivery",
  DELIVERED: "Delivered",
  DELIVERY_FAILED: "Delivery failed",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
  COMPLETED: "Completed",
};

/** screens-navigation.md §2.1 — one card, its action area shaped by the order's current status. A pickup order's card never shows rider information because there is none. */
export function OrderCard({ order, onChanged }: { order: OrderDto; onChanged: () => void }) {
  const [expanded, setExpanded] = useState<"reject" | "pickup" | null>(null);
  const [reason, setReason] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPickup = order.fulfilmentType === "pickup";

  async function run(action: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try {
      await action();
      setExpanded(null);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const isNew = order.status === "PAID";
  const badgeTone =
    order.status === "PAID"
      ? "bg-accent text-night"
      : ["DELIVERED", "COMPLETED"].includes(order.status)
        ? "bg-success/15 text-success"
        : ["CANCELLED", "REFUNDED", "DELIVERY_FAILED"].includes(order.status)
          ? "bg-danger/15 text-danger"
          : "bg-raised text-ink";
  const btn = "flex h-11 flex-1 items-center justify-center rounded-xl text-sm font-semibold transition-transform active:scale-[0.98] disabled:opacity-50";
  const primaryBtn = `${btn} bg-accent text-night`;
  const ghostBtn = `${btn} bg-card text-ink shadow-[inset_0_0_0_1px_rgb(var(--c-line))]`;
  const dangerBtn = `${btn} bg-card text-sale shadow-[inset_0_0_0_1px_#C2410C]`;

  return (
    <article
      className={`flex flex-col gap-3 rounded-[14px] bg-card p-3.5 ${isNew ? "shadow-[inset_0_0_0_2px_#FF5A19]" : "shadow-[inset_0_0_0_1px_rgb(var(--c-line))]"}`}
    >
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs font-semibold text-ink">#{order.id.slice(0, 4)}</span>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${badgeTone}`}>{STATUS_LABEL[order.status] ?? order.status}</span>
        <span className="rounded-md bg-raised px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted">{isPickup ? "Pickup" : "Delivery"}</span>
        <span className="ml-auto font-mono text-[11px] text-muted">
          {order.scheduledFor ? `For ${new Date(order.scheduledFor).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}` : "ASAP"}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        {order.items.map((item) => (
          <div key={item.id} className="flex justify-between text-[13px]">
            <span className="text-ink">
              {item.quantity}× {item.nameSnapshot}
            </span>
            <span className="font-mono text-muted">{formatNaira(minor(item.priceMinorSnapshot * item.quantity))}</span>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between border-t border-line pt-2 text-xs text-muted">
        <span>
          <a href={`tel:${order.contactPhone}`} className="font-medium text-ink underline underline-offset-2">
            {order.contactPhone}
          </a>
          {!isPickup && order.deliveryLandmark && <> · {order.deliveryLandmark}</>}
        </span>
        <span className="font-mono text-sm font-semibold text-ink">{formatNaira(minor(order.subtotalMinor))}</span>
      </div>

      {/* The code is still needed at the door for as long as pickup hasn't happened yet — READY_FOR_PICKUP
          (no rider has claimed it) AND RIDER_ASSIGNED (one has, but hasn't arrived/confirmed collection). It
          used to disappear from this card the moment a rider was assigned, even though it was still live and
          still required — a vendor with more than one order in flight at once had no way to tell which
          card's code belonged to the job actually being picked up, and would read out the wrong one. */}
      {(order.status === "READY_FOR_PICKUP" || order.status === "RIDER_ASSIGNED") && !isPickup && order.collectionCode && (
        <div className="rounded-xl border-2 border-dashed border-accent px-3 py-2 text-center">
          <p className="text-[10px] text-muted">Read this to the rider when they arrive</p>
          <p className="font-mono text-xl font-bold tracking-widest text-ink">{order.collectionCode}</p>
        </div>
      )}
      {order.status === "RIDER_ASSIGNED" && order.rider && (
        <p className="text-xs text-muted">
          Rider: {order.rider.fullName} · {order.rider.user.phone}
        </p>
      )}
      {order.status === "IN_TRANSIT" && <p className="text-xs text-muted">Out for delivery.</p>}

      {error && <p className="text-xs text-danger">{error}</p>}

      {order.status === "PAID" &&
        (expanded === "reject" ? (
          <div className="flex flex-col gap-2 border-t border-line pt-2.5">
            <Input placeholder="Reason for rejecting" value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="flex gap-2">
              <button
                type="button"
                className={dangerBtn}
                disabled={busy || reason.trim().length < 3}
                onClick={() => run(() => orderApi.rejectOrder(order.id, { reason: reason.trim() }))}
              >
                {busy ? "Rejecting…" : "Confirm reject"}
              </button>
              <button type="button" className={ghostBtn} onClick={() => setExpanded(null)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2 border-t border-line pt-2.5">
            <button type="button" className={primaryBtn} disabled={busy} onClick={() => run(() => orderApi.acceptOrder(order.id))}>
              {busy ? "Accepting…" : "Accept"}
            </button>
            <button type="button" className={dangerBtn} onClick={() => setExpanded("reject")}>
              Reject
            </button>
          </div>
        ))}

      {order.status === "PREPARING" && (
        <div className="border-t border-line pt-2.5">
          <button type="button" className={`${primaryBtn} w-full`} disabled={busy} onClick={() => run(() => orderApi.markReady(order.id))}>
            {busy ? "Marking ready…" : "Mark ready"}
          </button>
        </div>
      )}

      {order.status === "READY_FOR_PICKUP" &&
        isPickup &&
        (expanded === "pickup" ? (
          <div className="flex flex-col gap-2 border-t border-line pt-2.5">
            <Input placeholder="4-digit code" inputMode="numeric" maxLength={4} value={code} onChange={(e) => setCode(e.target.value)} />
            <div className="flex gap-2">
              <button type="button" className={primaryBtn} disabled={busy || code.length !== 4} onClick={() => run(() => orderApi.confirmPickup(order.id, { code }))}>
                {busy ? "Confirming…" : "Confirm"}
              </button>
              <button type="button" className={ghostBtn} onClick={() => setExpanded(null)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="border-t border-line pt-2.5">
            <button type="button" className={`${primaryBtn} w-full`} onClick={() => setExpanded("pickup")}>
              Confirm pickup
            </button>
          </div>
        ))}
    </article>
  );
}
