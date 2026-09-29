"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Star } from "lucide-react";
import { Button, useAuthSession } from "@closebuy/ui";
import { ApiClientError } from "@closebuy/api-client";
import { formatNaira, minor } from "@closebuy/types";
import type { OrderDto, OrderStatus, RatingDto } from "@closebuy/types";
import { orderApi, catalogApi } from "@/lib/api";
import { useCart, type CartItem, type CartVendor } from "@/lib/cart";

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
 * US-C-10 — one of these per rateable target (vendor always, rider only
 * on a delivery order once assigned). Self-contained: manages its own
 * score/comment/submit state rather than the parent juggling up to two
 * copies of the same form state. Locks to a read-only view once
 * `existing.editedUntil` has passed — the server enforces this
 * authoritatively regardless (RatingLockedError, order/service.ts).
 */
function RatingForm({
  label,
  existing,
  onSubmit,
}: {
  label: string;
  existing: RatingDto | undefined;
  onSubmit: (score: number, comment: string) => Promise<void>;
}) {
  const isLocked = Boolean(existing) && Date.now() > new Date(existing!.editedUntil).getTime();
  const [score, setScore] = useState(existing?.score ?? 0);
  const [comment, setComment] = useState(existing?.comment ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isLocked) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <p className="text-sm font-bold text-ink">{label}</p>
        <div className="mt-1 flex gap-0.5">
          {[1, 2, 3, 4, 5].map((n) => (
            <Star key={n} size={16} className={n <= existing!.score ? "fill-accent text-accent" : "text-gray-300"} />
          ))}
        </div>
        {existing!.comment && <p className="mt-1 text-sm text-muted">{existing!.comment}</p>}
      </div>
    );
  }

  async function handleSubmit() {
    if (score < 1) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await onSubmit(score, comment.trim());
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Couldn't save that rating.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-sm font-bold text-ink">{label}</p>
      {error && <p className="mt-1 text-sm text-danger">{error}</p>}
      <div className="mt-2 flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" onClick={() => setScore(n)} aria-label={`${n} star${n > 1 ? "s" : ""}`}>
            <Star size={22} className={n <= score ? "fill-accent text-accent" : "text-gray-300"} />
          </button>
        ))}
      </div>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={2}
        placeholder="Optional comment"
        maxLength={500}
        className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
      />
      <Button className="mt-2" disabled={isSubmitting || score < 1} onClick={handleSubmit}>
        {isSubmitting ? "Saving…" : existing ? "Update rating" : "Submit rating"}
      </Button>
    </div>
  );
}

/**
 * screens-navigation.md §1.7 — a status timeline, not a map (brief §3.5).
 * Works for a guest (the trackingToken is the whole point, US-C-06a) and
 * a signed-in customer alike; the only thing gated behind sign-in is the
 * cancel action, since that endpoint needs to know who's asking.
 */
export default function OrderTrackingPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const { session } = useAuthSession();
  const { cart, replaceCartItems } = useCart();

  const [order, setOrder] = useState<OrderDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [isReordering, setIsReordering] = useState(false);
  const [reorderError, setReorderError] = useState<string | null>(null);
  const [reorderNotice, setReorderNotice] = useState<string | null>(null);
  const [reorderConflict, setReorderConflict] = useState<{ vendor: CartVendor; items: CartItem[] } | null>(null);

  const [showDisputeForm, setShowDisputeForm] = useState(false);
  const [disputeReason, setDisputeReason] = useState("");
  const [disputeEvidenceText, setDisputeEvidenceText] = useState("");
  const [isSubmittingDispute, setIsSubmittingDispute] = useState(false);
  const [disputeError, setDisputeError] = useState<string | null>(null);

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

  /**
   * US-C-09 — "any past order can be reordered, subject to current stock
   * and price": re-fetches the vendor's live catalogue (never trusts the
   * order's own priceMinorSnapshot/nameSnapshot — those are a receipt of
   * what happened then, not what's buyable now) and drops any item that's
   * gone inactive or sold out, rather than failing the whole reorder.
   */
  async function buildReorderItems(): Promise<{ vendor: CartVendor; items: CartItem[]; skipped: number } | null> {
    if (!order) return null;
    const [{ vendor }, { products }] = await Promise.all([
      catalogApi.getVendor(order.vendorId),
      catalogApi.getVendorProducts(order.vendorId),
    ]);

    const items: CartItem[] = [];
    for (const orderItem of order.items) {
      const product = products.find((p) => p.id === orderItem.productId);
      if (!product || product.stock <= 0) continue;
      items.push({
        productId: product.id,
        name: product.name,
        priceMinor: product.priceMinor,
        stock: product.stock,
        quantity: Math.min(orderItem.quantity, product.stock),
      });
    }

    return {
      vendor: { id: vendor.id, businessName: vendor.businessName, supportsPickup: vendor.supportsPickup },
      items,
      skipped: order.items.length - items.length,
    };
  }

  async function handleReorder() {
    setReorderError(null);
    setReorderNotice(null);
    setIsReordering(true);
    try {
      const result = await buildReorderItems();
      if (!result) return;
      if (result.items.length === 0) {
        setReorderError("None of these items are available anymore.");
        return;
      }

      if (cart.vendor && cart.vendor.id !== result.vendor.id) {
        setReorderConflict({ vendor: result.vendor, items: result.items });
        return;
      }

      replaceCartItems(result.vendor, result.items);
      if (result.skipped > 0) {
        setReorderNotice(`${result.skipped} item(s) are no longer available and were left out.`);
      } else {
        router.push("/cart");
      }
    } catch (err) {
      setReorderError(err instanceof ApiClientError ? err.message : "Couldn't reorder this.");
    } finally {
      setIsReordering(false);
    }
  }

  function confirmReorderReplace() {
    if (!reorderConflict) return;
    replaceCartItems(reorderConflict.vendor, reorderConflict.items);
    setReorderConflict(null);
    router.push("/cart");
  }

  /** US-C-11 — same trackingToken-based route for a guest and a signed-in customer alike (US-C-06a). */
  async function handleSubmitDispute() {
    if (!order || disputeReason.trim().length < 10) return;
    const evidence = disputeEvidenceText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 5);

    setIsSubmittingDispute(true);
    setDisputeError(null);
    try {
      await orderApi.disputeOrder(token, { reason: disputeReason.trim(), evidence: evidence.length > 0 ? evidence : undefined });
      setShowDisputeForm(false);
      setDisputeReason("");
      setDisputeEvidenceText("");
      load();
    } catch (err) {
      setDisputeError(err instanceof ApiClientError ? err.message : "Couldn't submit that.");
    } finally {
      setIsSubmittingDispute(false);
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
      <div className="flex flex-col gap-3 p-4">
        <div className="h-6 w-1/2 animate-pulse rounded bg-surface" />
        <div className="h-32 w-full animate-pulse rounded-2xl bg-surface" />
        <div className="h-20 w-full animate-pulse rounded-2xl bg-surface" />
      </div>
    );
  }

  const isPickup = order.fulfilmentType === "pickup";
  const steps = isPickup ? PICKUP_STEPS : DELIVERY_STEPS;
  const isException = TERMINAL_EXCEPTIONS.includes(order.status);
  const exceptionTransition = isException ? [...order.transitions].reverse().find((t) => t.toStatus === order.status) : undefined;
  const isPendingPayment = order.status === "PENDING_PAYMENT";
  const canCancel = Boolean(session) && order.status === "PAID";

  // A scheduled order the vendor has just accepted reaches PREPARING
  // immediately, same as any ASAP order — the vendor still fully controls
  // when it actually becomes an active job (marking it ready is their own
  // later action), but showing "Preparing" as already underway days
  // before a scheduled slot would be misleading. Caps the displayed step
  // at "accepted", not the real order.status, only while it's still
  // exactly PREPARING and the slot hasn't arrived — any real vendor
  // action past that (marking ready) is genuine progress and shown as-is.
  const scheduledNotYetDue = Boolean(order.scheduledFor) && new Date(order.scheduledFor!).getTime() > Date.now();
  const showingAsAccepted = scheduledNotYetDue && order.status === "PREPARING";
  const currentIndex = steps.indexOf(showingAsAccepted ? "PAID" : order.status);

  // US-C-11 — mirrors the server's own window check (order/service.ts's
  // disputeOrder): within 48h of the DELIVERED transition, and not
  // already disputed. The server re-checks both authoritatively regardless.
  const deliveredAt = order.transitions.find((t) => t.toStatus === "DELIVERED")?.createdAt;
  const canDispute = !order.dispute && Boolean(deliveredAt) && Date.now() - new Date(deliveredAt!).getTime() < 48 * 60 * 60 * 1000;

  return (
    <div className="flex flex-col gap-5 p-4 pb-8">
      <div>
        <p className="text-xs font-medium text-muted">Order</p>
        <h1 className="text-xl font-bold text-ink">{order.vendor?.businessName ?? "Your order"}</h1>
        <p className="text-xs text-muted">Placed {new Date(order.createdAt).toLocaleString()}</p>
      </div>

      {isPendingPayment ? (
        // A card/transfer order whose Monnify payment hasn't been
        // confirmed yet — never shown as an empty, unexplained step list.
        // It either completes shortly (the webhook lands) or auto-expires
        // within pending_payment_expiry_minutes (order/service.ts's
        // expirePendingPayment) and this page reflects that once it does,
        // rather than promising a retry this app doesn't build.
        <div className="rounded-2xl bg-warning/10 p-4">
          <p className="font-bold text-warning">Waiting for payment confirmation</p>
          <p className="mt-1 text-sm text-ink">
            If you completed payment, this updates automatically within a minute or two. If you closed the payment
            page without finishing, this order will be cancelled automatically and nothing will be charged.
          </p>
          <Link href={`/vendors/${order.vendorId}`} className="mt-3 inline-block text-sm font-semibold text-primary underline">
            Start a new order with {order.vendor?.businessName ?? "this vendor"} instead
          </Link>
        </div>
      ) : isException ? (
        <div className="rounded-2xl bg-danger/10 p-4">
          <p className="font-bold text-danger">{stepLabel(order.status, isPickup) || order.status}</p>
          {exceptionTransition?.reason && <p className="mt-1 text-sm text-ink">{exceptionTransition.reason}</p>}
        </div>
      ) : (
        <>
          {showingAsAccepted && (
            <div className="rounded-2xl bg-primary/5 p-4">
              <p className="font-bold text-primary">Accepted — scheduled for {new Date(order.scheduledFor!).toLocaleString()}</p>
              <p className="mt-1 text-sm text-ink">The vendor will start preparing closer to your scheduled time.</p>
            </div>
          )}
          <ol className="flex flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          {steps.map((step, i) => {
            const transition = order.transitions.find((t) => t.toStatus === step);
            const done = currentIndex >= 0 && i <= currentIndex;
            const active = i === currentIndex;
            return (
              <li key={step} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span
                    className={`h-3.5 w-3.5 shrink-0 rounded-full ${done ? (active ? "bg-accent" : "bg-primary") : "border-2 border-gray-300 bg-white"}`}
                  />
                  {i < steps.length - 1 && <span className={`w-0.5 flex-1 ${done ? "bg-primary" : "bg-gray-200"}`} />}
                </div>
                <div className="pb-2">
                  <p className={`text-sm font-semibold ${done ? "text-ink" : "text-muted"}`}>{stepLabel(step, isPickup)}</p>
                  {transition && <p className="text-xs text-muted">{new Date(transition.createdAt).toLocaleTimeString()}</p>}
                </div>
              </li>
            );
          })}
          </ol>
        </>
      )}

      {isPickup && order.collectionCode && order.status === "READY_FOR_PICKUP" && (
        <div className="rounded-2xl border-2 border-dashed border-primary bg-primary/5 p-4 text-center">
          <p className="text-xs font-medium text-muted">Show this code at the counter</p>
          <p className="text-3xl font-extrabold tracking-widest text-primary">{order.collectionCode}</p>
        </div>
      )}

      {!isPickup && order.deliveryCode && ["READY_FOR_PICKUP", "RIDER_ASSIGNED", "IN_TRANSIT"].includes(order.status) && (
        <div className="rounded-2xl border-2 border-dashed border-primary bg-primary/5 p-4 text-center">
          <p className="text-xs font-medium text-muted">Read this to your rider when they arrive</p>
          <p className="text-3xl font-extrabold tracking-widest text-primary">{order.deliveryCode}</p>
        </div>
      )}

      {!isPickup && order.rider && (
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium text-muted">Your rider</p>
          <p className="font-bold text-ink">{order.rider.fullName}</p>
          <a href={`tel:${order.rider.user.phone}`} className="text-sm font-semibold text-primary underline">
            {order.rider.user.phone}
          </a>
        </div>
      )}

      {isPickup && order.vendor && (
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium text-muted">Pickup from</p>
          <p className="font-bold text-ink">{order.vendor.pickupLandmark}</p>
          <a href={`tel:${order.vendor.pickupPhone}`} className="text-sm font-semibold text-primary underline">
            {order.vendor.pickupPhone}
          </a>
        </div>
      )}

      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <p className="mb-2 text-sm font-bold text-ink">Items</p>
        <div className="flex flex-col gap-1.5">
          {order.items.map((item) => (
            <div key={item.id} className="flex justify-between text-sm">
              <span className="font-medium text-ink">
                {item.quantity}× {item.nameSnapshot}
              </span>
              <span className="text-muted">{formatNaira(minor(item.priceMinorSnapshot * item.quantity))}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-col gap-1 border-t border-gray-100 pt-2 text-sm">
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
          <div className="flex justify-between text-base font-bold text-ink">
            <span>Total</span>
            <span className="text-accent">{formatNaira(minor(order.totalMinor))}</span>
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

      {reorderConflict ? (
        <div className="flex flex-col gap-2 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-sm text-ink">
            Your cart has items from another vendor. Reordering replaces it with this order&apos;s items.
          </p>
          <div className="flex gap-2">
            <Button onClick={confirmReorderReplace}>Replace cart</Button>
            <Button variant="secondary" onClick={() => setReorderConflict(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <Button variant="secondary" onClick={handleReorder} disabled={isReordering}>
            {isReordering ? "Reordering…" : "Reorder"}
          </Button>
          {reorderError && <p className="text-xs text-danger">{reorderError}</p>}
          {reorderNotice && (
            <div className="flex flex-col gap-1">
              <p className="text-xs text-muted">{reorderNotice}</p>
              <Button variant="secondary" onClick={() => router.push("/cart")}>
                Go to cart
              </Button>
            </div>
          )}
        </div>
      )}

      {order.dispute ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-sm font-semibold text-ink">
            {order.dispute.status === "open" ? "Dispute under review" : "Dispute resolved"}
          </p>
          <p className="mt-1 text-sm text-ink">{order.dispute.reason}</p>
          {order.dispute.status === "resolved" && (
            <p className="mt-1 text-xs text-muted">
              Outcome: {order.dispute.resolution === "full_refund" && "Full refund issued"}
              {order.dispute.resolution === "partial_refund" && "Partial refund issued"}
              {order.dispute.resolution === "rejected" && "Not upheld — no refund"}
            </p>
          )}
        </div>
      ) : canDispute && (
        showDisputeForm ? (
          <div className="flex flex-col gap-2 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-sm font-medium text-ink">What went wrong?</p>
            {disputeError && <p className="text-sm text-danger">{disputeError}</p>}
            <textarea
              value={disputeReason}
              onChange={(e) => setDisputeReason(e.target.value)}
              rows={3}
              placeholder="e.g. Two items were missing when it arrived"
              minLength={10}
              maxLength={1000}
              className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
            />
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-ink">Photos (optional, one URL per line)</label>
              <p className="text-xs text-muted">No photo upload yet — paste hosted image URLs directly.</p>
              <textarea
                value={disputeEvidenceText}
                onChange={(e) => setDisputeEvidenceText(e.target.value)}
                rows={2}
                placeholder="https://…"
                className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant="danger"
                onClick={handleSubmitDispute}
                disabled={isSubmittingDispute || disputeReason.trim().length < 10}
              >
                {isSubmittingDispute ? "Submitting…" : "Submit"}
              </Button>
              <Button variant="secondary" onClick={() => setShowDisputeForm(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="secondary" onClick={() => setShowDisputeForm(true)}>
            Report a problem
          </Button>
        )
      )}

      {order.status === "COMPLETED" && (
        <div className="flex flex-col gap-3">
          <RatingForm
            label={`Rate ${order.vendor?.businessName ?? "the vendor"}`}
            existing={order.ratings.find((r) => r.targetType === "vendor")}
            onSubmit={async (score, comment) => {
              await orderApi.rateOrder(token, { targetType: "vendor", score, comment: comment || undefined });
              load();
            }}
          />
          {!isPickup && order.rider && (
            <RatingForm
              label={`Rate ${order.rider.fullName}, your rider`}
              existing={order.ratings.find((r) => r.targetType === "rider")}
              onSubmit={async (score, comment) => {
                await orderApi.rateOrder(token, { targetType: "rider", score, comment: comment || undefined });
                load();
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
