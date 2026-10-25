"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Check, Phone, Star, User } from "lucide-react";
import { ThemeToggle, useAuthSession } from "@closebuy/ui";
import { ApiClientError } from "@closebuy/api-client";
import { formatNaira, minor } from "@closebuy/types";
import type { OrderDto, OrderStatus, RatingDto } from "@closebuy/types";
import { orderApi } from "@/lib/api";
import { useReorder } from "@/lib/useReorder";

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

// The design's four-segment progress bar collapses the real status sequence:
// placed → packed → (rider/ready) → delivered.
function segmentOf(status: OrderStatus, isPickup: boolean): number {
  switch (status) {
    case "PAID":
      return 0;
    case "PREPARING":
      return 1;
    case "READY_FOR_PICKUP":
      return isPickup ? 2 : 1;
    case "RIDER_ASSIGNED":
    case "IN_TRANSIT":
      return 2;
    default:
      return 3; // DELIVERED / COMPLETED
  }
}

function headline(status: OrderStatus, isPickup: boolean): { kicker: string; title: string } {
  switch (status) {
    case "PAID":
      return { kicker: "Order placed", title: "Waiting for the shop" };
    case "PREPARING":
      return { kicker: "Shop is packing", title: "Getting your order ready" };
    case "READY_FOR_PICKUP":
      return isPickup
        ? { kicker: "Ready for you", title: "Come and collect" }
        : { kicker: "Packed", title: "Finding a rider" };
    case "RIDER_ASSIGNED":
      return { kicker: "Rider assigned", title: "Rider heading to the shop" };
    case "IN_TRANSIT":
      return { kicker: "Rider on the way", title: "Arriving soon" };
    case "DELIVERED":
    case "COMPLETED":
      return { kicker: isPickup ? "Collected" : "Delivered", title: "Enjoy your order" };
    default:
      return { kicker: "Order", title: stepLabel(status, isPickup) };
  }
}

const PAYMENT_LABEL: Record<string, string> = { cash_on_delivery: "Pay on delivery", card: "Card", transfer: "Bank transfer", online: "Paid online" };

const cardClass = "rounded-[14px] bg-card p-3.5";
const actionClass =
  "flex h-11 items-center justify-center rounded-xl bg-card text-[13px] font-medium text-ink shadow-[inset_0_0_0_1px_rgb(var(--c-line))] transition-transform active:scale-[0.98] disabled:opacity-50";

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
      <div className={cardClass}>
        <p className="text-sm font-bold text-ink">{label}</p>
        <div className="mt-1 flex gap-0.5">
          {[1, 2, 3, 4, 5].map((n) => (
            <Star key={n} size={16} className={n <= existing!.score ? "fill-accent text-accent" : "text-muted"} />
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
    <div className={cardClass}>
      <p className="text-sm font-bold text-ink">{label}</p>
      {error && <p className="mt-1 text-sm text-danger">{error}</p>}
      <div className="mt-2 flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" onClick={() => setScore(n)} aria-label={`${n} star${n > 1 ? "s" : ""}`} className="flex h-12 w-11 items-center justify-center">
            <Star size={34} strokeWidth={1.6} className={n <= score ? "fill-accent text-accent" : "text-muted"} />
          </button>
        ))}
      </div>
      <p className="mt-1 text-[13px] text-muted">{["Tap a star to rate", "Not great — tell us what went wrong", "Could be better", "Good", "Really good", "Excellent!"][score]}</p>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={2}
        placeholder="Optional comment"
        maxLength={500}
        className="mt-2 w-full resize-none rounded-[10px] border-0 bg-surface px-3 py-2.5 text-[13px] text-ink shadow-[inset_0_0_0_1px_rgb(var(--c-line))] outline-none focus:shadow-[inset_0_0_0_2px_#FF5A19]"
      />
      <button
        type="button"
        className="mt-2 flex h-11 w-full items-center justify-center rounded-xl bg-accent text-sm font-semibold text-night disabled:opacity-50"
        disabled={isSubmitting || score < 1}
        onClick={handleSubmit}
      >
        {isSubmitting ? "Saving…" : existing ? "Update rating" : "Submit rating"}
      </button>
    </div>
  );
}

/**
 * screens-navigation.md §1.7 — a status screen, not a live map (brief §3.5:
 * location is point-in-time, never continuous tracking, so there is no rider
 * dot to draw). Works for a guest (the trackingToken is the whole point,
 * US-C-06a) and a signed-in customer alike; the only thing gated behind
 * sign-in is the cancel action, since that endpoint needs to know who's asking.
 */
export default function OrderTrackingPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const { session } = useAuthSession();
  const reorder = useReorder();

  const [order, setOrder] = useState<OrderDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

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
        <div className="h-24 w-full animate-pulse rounded-[14px] bg-raised" />
        <div className="h-6 w-1/2 animate-pulse rounded bg-raised" />
        <div className="h-32 w-full animate-pulse rounded-[14px] bg-raised" />
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
  const shownStatus: OrderStatus = showingAsAccepted ? "PAID" : order.status;
  const currentIndex = steps.indexOf(shownStatus);
  const segment = segmentOf(shownStatus, isPickup);
  const copy = headline(shownStatus, isPickup);
  const itemCount = order.items.reduce((n, i) => n + i.quantity, 0);

  // US-C-11 — mirrors the server's own window check (order/service.ts's
  // disputeOrder): within 48h of the DELIVERED transition, and not
  // already disputed. The server re-checks both authoritatively regardless.
  const deliveredAt = order.transitions.find((t) => t.toStatus === "DELIVERED")?.createdAt;
  const canDispute = !order.dispute && Boolean(deliveredAt) && Date.now() - new Date(deliveredAt!).getTime() < 48 * 60 * 60 * 1000;
  const canRate = order.status === "COMPLETED";

  const segLabels = isPickup ? ["Placed", "Packed", "Ready", "Collected"] : ["Placed", "Packed", "On the way", "Delivered"];

  return (
    <div className="flex flex-col gap-3.5 px-4 pb-10 pt-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => (window.history.length > 1 ? router.back() : router.push("/orders"))}
          aria-label="Back"
          className="flex h-11 w-11 items-center justify-center rounded-[14px] bg-card text-ink"
        >
          <ArrowLeft size={18} strokeWidth={2.2} />
        </button>
        <span className="flex-1" />
        <span className="flex h-9 items-center rounded-full bg-card px-3 text-xs font-bold text-ink">Order #{order.id.slice(0, 4).toUpperCase()}</span>
        <ThemeToggle />
      </div>

      {isPendingPayment ? (
        // A card/transfer order whose Monnify payment hasn't been
        // confirmed yet — never shown as an empty, unexplained step list.
        // It either completes shortly (the webhook lands) or auto-expires
        // within pending_payment_expiry_minutes (order/service.ts's
        // expirePendingPayment) and this page reflects that once it does,
        // rather than promising a retry this app doesn't build.
        <div className="rounded-[14px] bg-warning/10 p-4">
          <p className="font-bold text-warning">Waiting for payment confirmation</p>
          <p className="mt-1 text-sm text-ink">
            If you completed payment, this updates automatically within a minute or two. If you closed the payment
            page without finishing, this order will be cancelled automatically and nothing will be charged.
          </p>
          <Link href={`/vendors/${order.vendorId}`} className="mt-3 inline-block text-sm font-semibold text-primary underline">
            Start a new order with {order.vendor?.businessName ?? "this shop"} instead
          </Link>
        </div>
      ) : isException ? (
        <div className="rounded-[14px] bg-danger/10 p-4">
          <p className="font-bold text-danger">{stepLabel(order.status, isPickup) || order.status}</p>
          {exceptionTransition?.reason && <p className="mt-1 text-sm text-ink">{exceptionTransition.reason}</p>}
        </div>
      ) : (
        <>
          {segment === 3 ? (
            <div className="flex flex-col items-center gap-2.5 rounded-[18px] bg-primary px-5 pb-6 pt-5 text-center text-[#FFF7F1]">
              <span className="flex h-[76px] w-[76px] items-center justify-center rounded-full bg-accent text-night">
                <Check size={36} strokeWidth={2.6} aria-hidden="true" />
              </span>
              <h1 className="text-[26px] font-semibold tracking-[-0.02em]">{isPickup ? "Collected!" : "Delivered!"}</h1>
              <span className="text-sm opacity-90">
                {order.vendor?.businessName ?? "Your order"} · {itemCount} item{itemCount === 1 ? "" : "s"} · {formatNaira(minor(order.totalMinor))}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-3.5 pt-1">
              {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset */}
              <img src="/logo-mark.png" alt="" className="object-contain h-[46px] w-11" />
              <div className="flex flex-col gap-0.5">
                <span className="text-[13px] font-bold text-primary dark:text-[#8FD1B5]">{copy.kicker}</span>
                <h1 className="text-2xl font-semibold tracking-[-0.02em] text-ink">{copy.title}</h1>
              </div>
            </div>
          )}

          {showingAsAccepted && (
            <div className="rounded-[14px] bg-primary/10 p-3.5">
              <p className="text-sm font-bold text-ink">Accepted — scheduled for {new Date(order.scheduledFor!).toLocaleString()}</p>
              <p className="mt-0.5 text-sm text-muted">The shop will start preparing closer to your scheduled time.</p>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <div className="flex gap-1.5" role="img" aria-label={`Order progress: step ${segment + 1} of 4`}>
              {segLabels.map((l, i) => (
                <span key={l} className={`h-1.5 flex-1 rounded-[3px] ${i < segment ? "bg-primary" : i === segment ? "bg-accent" : "bg-raised"}`} />
              ))}
            </div>
            <div className="grid grid-cols-4 text-[11px] text-muted">
              {segLabels.map((l, i) => (
                <span key={l} className={i === segment ? "font-bold text-ink" : ""}>
                  {l}
                </span>
              ))}
            </div>
          </div>
        </>
      )}

      {isPickup && order.collectionCode && order.status === "READY_FOR_PICKUP" && (
        <div className="rounded-[14px] border-2 border-dashed border-accent bg-card p-4 text-center">
          <p className="text-xs font-medium text-muted">Show this code at the counter</p>
          <p className="font-mono text-3xl font-extrabold tracking-widest text-ink">{order.collectionCode}</p>
        </div>
      )}

      {!isPickup && order.deliveryCode && ["READY_FOR_PICKUP", "RIDER_ASSIGNED", "IN_TRANSIT"].includes(order.status) && (
        <div className="rounded-[14px] border-2 border-dashed border-accent bg-card p-4 text-center">
          <p className="text-xs font-medium text-muted">Read this to your rider when they arrive</p>
          <p className="font-mono text-3xl font-extrabold tracking-widest text-ink">{order.deliveryCode}</p>
        </div>
      )}

      {!isPickup && order.rider && (
        <div className="flex items-center gap-3 rounded-[14px] bg-card p-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-raised text-muted">
            <User size={22} strokeWidth={1.8} />
          </span>
          <span className="flex flex-1 flex-col gap-0.5">
            <span className="font-bold text-ink">{order.rider.fullName}</span>
            <span className="text-xs text-muted">Your CloseBuy rider</span>
          </span>
          <a href={`tel:${order.rider.user.phone}`} aria-label="Call rider" className="flex h-11 w-11 items-center justify-center rounded-[14px] bg-accent text-night">
            <Phone size={18} strokeWidth={2} />
          </a>
        </div>
      )}

      {isPickup && order.vendor && (
        <div className="flex items-center gap-3 rounded-[14px] bg-card p-3.5">
          <span className="flex flex-1 flex-col gap-0.5">
            <span className="text-xs text-muted">Pickup from</span>
            <span className="font-bold text-ink">{order.vendor.pickupLandmark}</span>
          </span>
          <a href={`tel:${order.vendor.pickupPhone}`} aria-label="Call shop" className="flex h-11 w-11 items-center justify-center rounded-[14px] bg-accent text-night">
            <Phone size={18} strokeWidth={2} />
          </a>
        </div>
      )}

      <div className="flex items-center justify-between rounded-[14px] bg-card p-3.5">
        <span className="flex flex-col gap-0.5">
          <span className="text-xs text-muted">{order.vendor?.businessName ?? "Your order"}</span>
          <span className="text-sm font-bold text-ink">
            {itemCount} item{itemCount === 1 ? "" : "s"} · {PAYMENT_LABEL[order.paymentMethod] ?? order.paymentMethod}
          </span>
        </span>
        <span className="text-lg font-semibold text-ink">{formatNaira(minor(order.totalMinor))}</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {canCancel && (
          <button
            type="button"
            onClick={handleCancel}
            disabled={isCancelling}
            className="flex h-11 items-center justify-center rounded-xl bg-card text-[13px] font-medium text-sale shadow-[inset_0_0_0_1px_#C2410C] disabled:opacity-60"
          >
            {isCancelling ? "Cancelling…" : "Cancel order"}
          </button>
        )}
        <button type="button" onClick={() => reorder.reorder(order)} disabled={reorder.busy} className={actionClass}>
          {reorder.busy ? "Reordering…" : "Reorder"}
        </button>
        {!order.dispute && canDispute && (
          <button type="button" onClick={() => setShowDisputeForm((v) => !v)} className={actionClass}>
            Report a problem
          </button>
        )}
        {canRate && (
          <a href="#rate" className={actionClass}>
            Rate order ★
          </a>
        )}
      </div>
      {cancelError && <p className="text-xs text-danger">{cancelError}</p>}
      {reorder.error && <p className="text-xs text-danger">{reorder.error}</p>}
      {reorder.notice && (
        <div className="flex flex-col gap-2 rounded-[14px] bg-card p-3.5">
          <p className="text-xs text-muted">{reorder.notice}</p>
          <button type="button" onClick={() => router.push("/cart")} className={actionClass}>
            Go to bag
          </button>
        </div>
      )}

      {order.dispute ? (
        <div className={cardClass}>
          <p className="text-sm font-semibold text-ink">{order.dispute.status === "open" ? "Dispute under review" : "Dispute resolved"}</p>
          <p className="mt-1 text-sm text-ink">{order.dispute.reason}</p>
          {order.dispute.status === "resolved" && (
            <p className="mt-1 text-xs text-muted">
              Outcome: {order.dispute.resolution === "full_refund" && "Full refund issued"}
              {order.dispute.resolution === "partial_refund" && "Partial refund issued"}
              {order.dispute.resolution === "rejected" && "Not upheld — no refund"}
            </p>
          )}
        </div>
      ) : (
        canDispute &&
        showDisputeForm && (
          <div className="flex flex-col gap-2.5 rounded-[14px] bg-card p-3.5 shadow-[inset_0_0_0_1px_#FF5A19]">
            <p className="text-sm font-semibold text-ink">What went wrong?</p>
            {disputeError && <p className="text-sm text-danger">{disputeError}</p>}
            <textarea
              value={disputeReason}
              onChange={(e) => setDisputeReason(e.target.value)}
              rows={3}
              placeholder="e.g. Two items were missing when it arrived"
              minLength={10}
              maxLength={1000}
              className="resize-none rounded-[10px] border-0 bg-surface px-3 py-2.5 text-[13px] text-ink shadow-[inset_0_0_0_1px_rgb(var(--c-line))] outline-none focus:shadow-[inset_0_0_0_2px_#FF5A19]"
            />
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-ink">Photos (optional, one URL per line)</label>
              <p className="text-xs text-muted">No photo upload yet — paste hosted image URLs directly.</p>
              <textarea
                value={disputeEvidenceText}
                onChange={(e) => setDisputeEvidenceText(e.target.value)}
                rows={2}
                placeholder="https://…"
                className="resize-none rounded-[10px] border-0 bg-surface px-3 py-2.5 text-[13px] text-ink shadow-[inset_0_0_0_1px_rgb(var(--c-line))] outline-none focus:shadow-[inset_0_0_0_2px_#FF5A19]"
              />
            </div>
            <span className="font-mono text-[11px] uppercase text-muted">A dispute opens for our team to review</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleSubmitDispute}
                disabled={isSubmittingDispute || disputeReason.trim().length < 10}
                className="flex h-11 flex-1 items-center justify-center rounded-xl bg-accent text-sm font-semibold text-night disabled:opacity-50"
              >
                {isSubmittingDispute ? "Submitting…" : "Send report"}
              </button>
              <button type="button" onClick={() => setShowDisputeForm(false)} className={`${actionClass} px-4`}>
                Cancel
              </button>
            </div>
          </div>
        )
      )}

      {!isPendingPayment && !isException && (
        <ol className={`${cardClass} flex flex-col gap-4`} aria-label="Order updates">
          {steps.map((step, i) => {
            const transition = order.transitions.find((t) => t.toStatus === step);
            const done = currentIndex >= 0 && i <= currentIndex;
            const active = i === currentIndex;
            return (
              <li key={step} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span className={`h-3.5 w-3.5 shrink-0 rounded-full ${done ? (active ? "bg-accent" : "bg-primary") : "border-2 border-line bg-card"}`} />
                  {i < steps.length - 1 && <span className={`w-0.5 flex-1 ${done ? "bg-primary" : "bg-raised"}`} />}
                </div>
                <div className="pb-2">
                  <p className={`text-sm font-semibold ${done ? "text-ink" : "text-muted"}`}>{stepLabel(step, isPickup)}</p>
                  {transition && <p className="font-mono text-[11px] text-muted">{new Date(transition.createdAt).toLocaleTimeString()}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <div className={cardClass}>
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
        <div className="mt-3 flex flex-col gap-1 border-t border-line pt-2 text-sm">
          <div className="flex justify-between text-muted">
            <span>Subtotal</span>
            <span>{formatNaira(minor(order.subtotalMinor))}</span>
          </div>
          {order.deliveryFeeMinor > 0 && (
            <div className="flex justify-between text-muted">
              <span>Delivery</span>
              <span>{formatNaira(minor(order.deliveryFeeMinor))}</span>
            </div>
          )}
          <div className="flex justify-between text-base font-semibold text-ink">
            <span>Total</span>
            <span>{formatNaira(minor(order.totalMinor))}</span>
          </div>
        </div>
      </div>

      {canRate && (
        <div id="rate" className="flex scroll-mt-4 flex-col gap-3">
          <RatingForm
            label={`Rate ${order.vendor?.businessName ?? "the shop"}`}
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

      {reorder.dialog}
    </div>
  );
}
