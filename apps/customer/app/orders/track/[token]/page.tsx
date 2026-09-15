"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Button, useAuthSession } from "@closebuy/ui";
import { ApiClientError } from "@closebuy/api-client";
import { formatNaira, minor } from "@closebuy/types";
import type { OrderDto, OrderStatus } from "@closebuy/types";
import { orderApi } from "@/lib/api";

const PICKUP_STEPS: OrderStatus[] = ["PAID", "PREPARING", "READY_FOR_PICKUP", "DELIVERED"];
const DELIVERY_STEPS: OrderStatus[] = ["PAID", "PREPARING", "READY_FOR_PICKUP", "RIDER_ASSIGNED", "IN_TRANSIT", "DELIVERED"];
const TERMINAL_EXCEPTIONS: OrderStatus[] = ["CANCELLED", "REFUNDED", "DELIVERY_FAILED"];
const TERMINAL: OrderStatus[] = ["COMPLETED", "CANCELLED", "REFUNDED", "DELIVERY_FAILED"];

function stepLabel(status: OrderStatus, isPickup: boolean): string {
  if (status === "READY_FOR_PICKUP") return isPickup ? "Ready for pickup" : "Ready — finding a rider";
  if (status === "DELIVERED") return isPickup ? "Collected" : "Delivered";
  const labels: Partial<Record<OrderStatus, string>> = {
    PAID: "Order placed",
    PREPARING: "Preparing",
    RIDER_ASSIGNED: "Rider assigned",
    IN_TRANSIT: "On the way",
  };
  return labels[status] ?? status;
}

/**
 * screens-navigation.md §1.7 — a status timeline, not a map (brief §3.5).
 * Works for a guest (the trackingToken is the whole point, US-C-06a) and
 * a signed-in customer alike; the only thing gated behind sign-in is the
 * cancel action, since that endpoint needs to know who's asking.
 */
export default function OrderTrackingPage() {
  const { token } = useParams<{ token: string }>();
  const { session } = useAuthSession();

  const [order, setOrder] = useState<OrderDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const load = useCallback(() => {
    orderApi
      .getOrderByTrackingToken(token)
      .then((res) => setOrder(res.order))
      .catch((err) => setError(err instanceof ApiClientError ? err.message : "Couldn't load this order."));
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  // Light polling while the order is still moving — a real-time push feed
  // (NFR-03) isn't wired into this screen yet, this is the interim
  // substitute so a customer doesn't have to manually refresh.
  useEffect(() => {
    if (!order || TERMINAL.includes(order.status)) return;
    const interval = setInterval(load, 8000);
    return () => clearInterval(interval);
  }, [order, load]);

  async function handleCancel() {
    if (!order) return;
    setCancelError(null);
    setIsCancelling(true);
    try {
      await orderApi.cancelOrder(order.id);
      load();
    } catch (err) {
      setCancelError(err instanceof ApiClientError ? err.message : "Couldn't cancel this order.");
    } finally {
      setIsCancelling(false);
    }
  }

  if (error) {
    return (
      <div className="p-4">
        <p className="text-sm text-danger">{error}</p>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="p-4">
        <p className="text-sm text-muted">Loading…</p>
      </div>
    );
  }

  const isPickup = order.fulfilmentType === "pickup";
  const steps = isPickup ? PICKUP_STEPS : DELIVERY_STEPS;
  const currentIndex = steps.indexOf(order.status);
  const isException = TERMINAL_EXCEPTIONS.includes(order.status);
  const exceptionTransition = isException ? [...order.transitions].reverse().find((t) => t.toStatus === order.status) : undefined;
  const canCancel = Boolean(session) && order.status === "PAID";

  return (
    <div className="flex flex-col gap-5 p-4 pb-8">
      <div>
        <p className="text-xs text-muted">Order</p>
        <h1 className="text-lg font-bold text-ink">{order.vendor?.businessName ?? "Your order"}</h1>
        <p className="text-xs text-muted">Placed {new Date(order.createdAt).toLocaleString()}</p>
      </div>

      {isException ? (
        <div className="rounded-xl bg-danger/10 p-4">
          <p className="font-semibold text-danger">{stepLabel(order.status, isPickup) || order.status}</p>
          {exceptionTransition?.reason && <p className="mt-1 text-sm text-ink">{exceptionTransition.reason}</p>}
        </div>
      ) : (
        <ol className="flex flex-col gap-4">
          {steps.map((step, i) => {
            const transition = order.transitions.find((t) => t.toStatus === step);
            const done = currentIndex >= 0 && i <= currentIndex;
            const active = i === currentIndex;
            return (
              <li key={step} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span
                    className={`h-3 w-3 rounded-full ${done ? (active ? "bg-accent" : "bg-primary") : "border-2 border-gray-300 bg-white"}`}
                  />
                  {i < steps.length - 1 && <span className={`w-0.5 flex-1 ${done ? "bg-primary" : "bg-gray-200"}`} />}
                </div>
                <div className="pb-2">
                  <p className={`text-sm font-medium ${done ? "text-ink" : "text-muted"}`}>{stepLabel(step, isPickup)}</p>
                  {transition && <p className="text-xs text-muted">{new Date(transition.createdAt).toLocaleTimeString()}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {isPickup && order.collectionCode && order.status === "READY_FOR_PICKUP" && (
        <div className="rounded-xl border-2 border-dashed border-primary p-4 text-center">
          <p className="text-xs text-muted">Show this code at the counter</p>
          <p className="text-3xl font-bold tracking-widest text-primary">{order.collectionCode}</p>
        </div>
      )}

      {!isPickup && order.rider && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs text-muted">Your rider</p>
          <p className="font-medium text-ink">{order.rider.fullName}</p>
          <a href={`tel:${order.rider.user.phone}`} className="text-sm text-primary underline">
            {order.rider.user.phone}
          </a>
        </div>
      )}

      {isPickup && order.vendor && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs text-muted">Pickup from</p>
          <p className="font-medium text-ink">{order.vendor.pickupLandmark}</p>
          <a href={`tel:${order.vendor.pickupPhone}`} className="text-sm text-primary underline">
            {order.vendor.pickupPhone}
          </a>
        </div>
      )}

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <p className="mb-2 text-sm font-medium text-ink">Items</p>
        <div className="flex flex-col gap-1.5">
          {order.items.map((item) => (
            <div key={item.id} className="flex justify-between text-sm">
              <span className="text-ink">
                {item.quantity}× {item.nameSnapshot}
              </span>
              <span className="text-muted">{formatNaira(minor(item.priceMinorSnapshot * item.quantity))}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-col gap-1 border-t border-gray-200 pt-2 text-sm">
          <div className="flex justify-between text-muted">
            <span>Subtotal</span>
            <span>{formatNaira(minor(order.subtotalMinor))}</span>
          </div>
          {order.deliveryFeeMinor > 0 && (
            <div className="flex justify-between text-muted">
              <span>Delivery fee</span>
              <span>{formatNaira(minor(order.deliveryFeeMinor))}</span>
            </div>
          )}
          <div className="flex justify-between font-semibold text-ink">
            <span>Total</span>
            <span>{formatNaira(minor(order.totalMinor))}</span>
          </div>
        </div>
      </div>

      {canCancel && (
        <div className="flex flex-col gap-1">
          <Button variant="danger" onClick={handleCancel} disabled={isCancelling}>
            {isCancelling ? "Cancelling…" : "Cancel order"}
          </Button>
          {cancelError && <p className="text-xs text-danger">{cancelError}</p>}
        </div>
      )}
    </div>
  );
}
