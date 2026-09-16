"use client";

import { useState } from "react";
import { Button, Input } from "@closebuy/ui";
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

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-ink">
            {STATUS_LABEL[order.status] ?? order.status} · {isPickup ? "Pickup" : "Delivery"}
          </p>
          <p className="text-xs text-muted">
            {order.scheduledFor ? `Scheduled ${new Date(order.scheduledFor).toLocaleString()}` : "As soon as possible"}
          </p>
        </div>
        <p className="text-sm font-semibold text-ink">{formatNaira(minor(order.totalMinor))}</p>
      </div>

      <div className="text-xs text-muted">
        {order.items.map((item) => `${item.quantity}× ${item.nameSnapshot}`).join(", ")}
      </div>

      <div className="text-xs text-muted">
        Contact: <a href={`tel:${order.contactPhone}`} className="text-primary underline">{order.contactPhone}</a>
        {!isPickup && order.deliveryLandmark && <> · {order.deliveryLandmark}</>}
      </div>

      {order.status === "READY_FOR_PICKUP" && !isPickup && order.collectionCode && (
        <div className="rounded-lg border-2 border-dashed border-primary px-3 py-2 text-center">
          <p className="text-[10px] text-muted">Read this to the rider when they arrive</p>
          <p className="text-xl font-bold tracking-widest text-primary">{order.collectionCode}</p>
        </div>
      )}
      {order.status === "RIDER_ASSIGNED" && order.rider && (
        <p className="text-xs text-muted">Rider: {order.rider.fullName} · {order.rider.user.phone}</p>
      )}
      {order.status === "IN_TRANSIT" && <p className="text-xs text-muted">Out for delivery.</p>}

      {error && <p className="text-xs text-danger">{error}</p>}

      {order.status === "PAID" &&
        (expanded === "reject" ? (
          <div className="flex flex-col gap-2 border-t border-gray-200 pt-2">
            <Input placeholder="Reason for rejecting" value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="flex gap-2">
              <Button
                variant="danger"
                disabled={busy || reason.trim().length < 3}
                onClick={() => run(() => orderApi.rejectOrder(order.id, { reason: reason.trim() }))}
              >
                {busy ? "Rejecting…" : "Confirm reject"}
              </Button>
              <Button variant="secondary" onClick={() => setExpanded(null)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2 border-t border-gray-200 pt-2">
            <Button disabled={busy} onClick={() => run(() => orderApi.acceptOrder(order.id))}>
              {busy ? "Accepting…" : "Accept"}
            </Button>
            <Button variant="danger" onClick={() => setExpanded("reject")}>Reject</Button>
          </div>
        ))}

      {order.status === "PREPARING" && (
        <div className="border-t border-gray-200 pt-2">
          <Button disabled={busy} onClick={() => run(() => orderApi.markReady(order.id))}>
            {busy ? "Marking ready…" : "Mark ready"}
          </Button>
        </div>
      )}

      {order.status === "READY_FOR_PICKUP" && isPickup && (
        expanded === "pickup" ? (
          <div className="flex flex-col gap-2 border-t border-gray-200 pt-2">
            <Input placeholder="6-digit code" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} />
            <div className="flex gap-2">
              <Button
                disabled={busy || code.length !== 6}
                onClick={() => run(() => orderApi.confirmPickup(order.id, { code }))}
              >
                {busy ? "Confirming…" : "Confirm"}
              </Button>
              <Button variant="secondary" onClick={() => setExpanded(null)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <div className="border-t border-gray-200 pt-2">
            <Button onClick={() => setExpanded("pickup")}>Confirm pickup</Button>
          </div>
        )
      )}
    </div>
  );
}
