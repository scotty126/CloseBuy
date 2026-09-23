"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Button, Card, Input, StatusBadge, useAuthSession } from "@closebuy/ui";
import { ApiClientError } from "@closebuy/api-client";
import { formatNaira, minor } from "@closebuy/types";
import type { OrderDto } from "@closebuy/types";
import { adminApi } from "@/lib/api";

type Action = "reassign-rider" | "force-cancel" | "force-refund" | null;

const REASSIGNABLE_STATUSES = ["RIDER_ASSIGNED", "IN_TRANSIT"];
const CANCELLABLE_STATUSES = ["PAID", "PREPARING", "READY_FOR_PICKUP", "RIDER_ASSIGNED", "IN_TRANSIT", "DELIVERED"];

/** screens-navigation.md §4.2 — US-A-03. Full detail, complete append-only transition history, and the three intervention actions. */
export default function AdminOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { session, isLoaded } = useAuthSession();

  const [order, setOrder] = useState<OrderDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [action, setAction] = useState<Action>(null);
  const [reason, setReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isLoaded && !session) router.push("/login");
  }, [isLoaded, session, router]);

  function load() {
    adminApi
      .getOrder(id)
      .then((res) => setOrder(res.order))
      .catch((err) => setLoadError(err instanceof ApiClientError ? err.message : "Couldn't load this order."));
  }

  useEffect(() => {
    if (!session) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, id]);

  if (!isLoaded || !session) return null;

  async function handleAction() {
    if (!action || !reason.trim()) return;
    setIsSubmitting(true);
    setActionError(null);
    try {
      if (action === "reassign-rider") await adminApi.reassignRider(id, { reason: reason.trim() });
      if (action === "force-cancel") await adminApi.forceCancelOrder(id, { reason: reason.trim() });
      if (action === "force-refund") await adminApi.forceRefundOrder(id, { reason: reason.trim() });
      setAction(null);
      setReason("");
      load();
    } catch (err) {
      setActionError(err instanceof ApiClientError ? err.message : "That action didn't go through.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (loadError) return <p className="text-sm text-danger">{loadError}</p>;
  if (!order) return <p className="text-sm text-muted">Loading…</p>;

  const canReassign = order.riderId && REASSIGNABLE_STATUSES.includes(order.status);
  const canForceCancel = CANCELLABLE_STATUSES.includes(order.status);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/orders" className="text-sm text-muted underline">← All orders</Link>
          <h1 className="mt-1 text-xl font-bold text-ink">Order {order.id.slice(0, 8)}</h1>
        </div>
        <StatusBadge status={order.status} />
      </div>

      <Card className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
        <Info label="Vendor" value={order.vendor?.businessName ?? order.vendorId} />
        <Info label="Rider" value={order.rider?.fullName ?? "None assigned"} />
        <Info label="Fulfilment" value={order.fulfilmentType} />
        <Info label="Payment method" value={order.paymentMethod} />
        <Info label="Contact phone" value={order.contactPhone} />
        <Info label="Alternate phone" value={order.alternateContactPhone ?? "—"} />
        {order.fulfilmentType === "delivery" && (
          <>
            <Info label="Delivery landmark" value={order.deliveryLandmark ?? "—"} />
            <Info label="Coordinates" value={order.deliveryLat && order.deliveryLng ? `${order.deliveryLat}, ${order.deliveryLng}` : "—"} />
            <Info label="Collection code (vendor→rider)" value={order.collectionCode ?? "—"} />
            <Info label="Delivery code (customer→rider)" value={order.deliveryCode ?? "—"} />
          </>
        )}
        {order.fulfilmentType === "pickup" && <Info label="Collection code" value={order.collectionCode ?? "—"} />}
        <Info label="Placed" value={new Date(order.createdAt).toLocaleString()} />
        <Info label="Last updated" value={new Date(order.updatedAt).toLocaleString()} />
      </Card>

      <Card>
        <p className="mb-2 text-sm font-semibold text-ink">Items</p>
        <div className="flex flex-col divide-y divide-gray-100">
          {order.items.map((item) => (
            <div key={item.id} className="flex justify-between py-1.5 text-sm">
              <span className="text-ink">{item.quantity}× {item.nameSnapshot}</span>
              <span className="text-muted">{formatNaira(minor(item.priceMinorSnapshot * item.quantity))}</span>
            </div>
          ))}
        </div>
        <div className="mt-2 flex flex-col gap-1 border-t border-gray-200 pt-2 text-sm">
          <Money label="Subtotal" value={order.subtotalMinor} />
          <Money label="Delivery fee" value={order.deliveryFeeMinor} />
          <Money label="Discount" value={-order.discountMinor} />
          <Money label="Platform commission" value={order.commissionMinor} />
          <div className="flex justify-between font-semibold text-ink">
            <span>Total</span>
            <span>{formatNaira(minor(order.totalMinor))}</span>
          </div>
        </div>
      </Card>

      <Card>
        <p className="mb-2 text-sm font-semibold text-ink">Transition history</p>
        <div className="flex flex-col gap-2">
          {order.transitions.map((t) => (
            <div key={t.id} className="flex items-center justify-between text-sm">
              <span className="text-ink">
                {t.fromStatus ? `${t.fromStatus} → ${t.toStatus}` : t.toStatus}
                <span className="ml-2 text-xs text-muted">({t.actorType})</span>
              </span>
              <span className="text-xs text-muted">{new Date(t.createdAt).toLocaleString()}</span>
            </div>
          ))}
          {order.transitions.map((t) => t.reason && (
            <p key={`${t.id}-reason`} className="text-xs italic text-muted">"{t.reason}"</p>
          ))}
        </div>
      </Card>

      <Card className="flex flex-col gap-3">
        <p className="text-sm font-semibold text-ink">Interventions (US-A-03)</p>
        {actionError && <p className="text-sm text-danger">{actionError}</p>}

        {action ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-ink">
              {action === "reassign-rider" && "Pull this order back into the open rider pool."}
              {action === "force-cancel" && "Stop this order and refund the customer if anything was charged."}
              {action === "force-refund" && "Refund the customer without changing the order's own status."}
            </p>
            <Input
              label="Reason (required — written to the audit log)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
            />
            <div className="flex gap-2">
              <Button type="button" variant="danger" disabled={isSubmitting || !reason.trim()} onClick={handleAction}>
                {isSubmitting ? "Working…" : "Confirm"}
              </Button>
              <Button type="button" variant="secondary" onClick={() => { setAction(null); setReason(""); }}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <Button type="button" variant="secondary" disabled={!canReassign} onClick={() => setAction("reassign-rider")}>
              Reassign rider
            </Button>
            <Button type="button" variant="danger" disabled={!canForceCancel} onClick={() => setAction("force-cancel")}>
              Force cancel
            </Button>
            <Button type="button" variant="danger" onClick={() => setAction("force-refund")}>
              Force refund
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className="text-ink">{value}</p>
    </div>
  );
}

function Money({ label, value }: { label: string; value: number }) {
  if (!value) return null;
  return (
    <div className="flex justify-between text-muted">
      <span>{label}</span>
      <span>{formatNaira(minor(value))}</span>
    </div>
  );
}
