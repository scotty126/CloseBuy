"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, Input } from "@closebuy/ui";
import { ApiClientError } from "@closebuy/api-client";
import { formatNaira, minor } from "@closebuy/types";
import type { RiderProfileDto, RiderJobDto, RiderEarningsDto } from "@closebuy/types";
import { dispatchApi } from "@/lib/api";
import { RiderGate } from "@/components/RiderGate";
import { LinkButton } from "@/components/LinkButton";

const POLL_MS = 5000; // faster than the vendor/customer 8s polls — a rider mid-shift needs the freshest read

function mapsLink(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

/** The redesign's duty card: one big switch at the top of the Jobs screen. */
function DutyCard({ onDuty, busy, onToggle }: { onDuty: boolean; busy: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={onDuty}
      onClick={onToggle}
      disabled={busy}
      className={`flex w-full items-center justify-between rounded-[14px] p-3.5 text-left transition-colors disabled:opacity-70 ${
        onDuty ? "bg-primary text-[#FFF7F1]" : "bg-card text-ink shadow-[inset_0_0_0_1px_rgb(var(--c-line))]"
      }`}
    >
      <span className="flex flex-col gap-0.5">
        <span className="font-mono text-[10px] uppercase opacity-80">Duty status</span>
        <span className="text-lg font-semibold">{busy ? "Updating…" : onDuty ? "On duty" : "Off duty"}</span>
      </span>
      <span className={`flex h-7 w-12 items-center rounded-full p-0.5 transition-colors ${onDuty ? "bg-accent" : "bg-muted/40"}`}>
        <span className={`h-6 w-6 rounded-full bg-white shadow transition-transform ${onDuty ? "translate-x-5" : ""}`} />
      </span>
    </button>
  );
}

function ScreenTitle({ title, subtitle, tone }: { title: string; subtitle?: string; tone?: "on" | "off" }) {
  return (
    <div className="flex flex-col gap-0.5">
      <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-ink">{title}</h1>
      {subtitle && <span className={`font-mono text-[11px] uppercase ${tone === "on" ? "text-success" : "text-muted"}`}>{subtitle}</span>}
    </div>
  );
}

/** screens-navigation.md §3.1/3.2 — one screen, shaped by state: off duty / waiting / offer / active job. No persistent tab bar (layout.tsx) — a rider mid-delivery should never have to think about where to tap. */
export default function HomePage() {
  return <RiderGate>{(rider, refetch) => <DutyScreen rider={rider} refetchRider={refetch} />}</RiderGate>;
}

function DutyScreen({ rider, refetchRider }: { rider: RiderProfileDto; refetchRider: () => void }) {
  const [activeJob, setActiveJob] = useState<RiderJobDto | null>(null);
  const [offers, setOffers] = useState<RiderJobDto[]>([]);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [togglingDuty, setTogglingDuty] = useState(false);
  // Set the moment reportDeliveryFailed succeeds, from the order that was just active — `load()` would
  // otherwise immediately drop it (getActiveJob() returns null once the order is DELIVERY_FAILED) and the
  // rider would land back on "waiting for a job" mid-sentence, never told where to take what they're still
  // physically holding (US-R-06's own acceptance criterion: "instructed whether to return the goods").
  const [justFailedOrder, setJustFailedOrder] = useState<RiderJobDto | null>(null);

  function load() {
    if (!rider.onDuty) return;
    Promise.all([dispatchApi.getActiveJob(), dispatchApi.listOffers()])
      .then(([activeRes, offersRes]) => {
        setActiveJob(activeRes.order);
        setOffers(offersRes.offers);
      })
      .catch((err) => setError(err instanceof ApiClientError ? err.message : "Couldn't refresh."));
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, POLL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rider.onDuty]);

  async function handleToggleDuty() {
    setError(null);
    setTogglingDuty(true);
    try {
      await dispatchApi.setDuty({ onDuty: !rider.onDuty });
      refetchRider();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Couldn't update duty status.");
    } finally {
      setTogglingDuty(false);
    }
  }

  if (!rider.onDuty) {
    return (
      <div className="flex flex-col gap-3.5 px-4 pb-6 pt-3.5">
        <ScreenTitle title="Jobs" subtitle="Off duty" />
        <DutyCard onDuty={false} busy={togglingDuty} onToggle={handleToggleDuty} />
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex flex-col items-center gap-2 rounded-[14px] px-[18px] py-8 text-center shadow-[inset_0_0_0_1px_rgb(var(--c-line))]">
          {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset */}
          <img src="/logo-mark.png" alt="" className="object-contain h-[46px] w-11 opacity-50" />
          <span className="font-semibold text-ink">You&apos;re off duty</span>
          <span className="text-[13px] leading-normal text-muted">Go on duty to start receiving delivery offers near you.</span>
        </div>
      </div>
    );
  }

  if (justFailedOrder) {
    return (
      <ReturnGoodsScreen
        order={justFailedOrder}
        onDone={() => {
          setJustFailedOrder(null);
          load();
        }}
      />
    );
  }

  if (activeJob) {
    return <ActiveJob order={activeJob} onChanged={load} onFailed={(order) => { setActiveJob(null); setJustFailedOrder(order); }} />;
  }

  const currentOffer = offers.find((o) => !dismissedIds.has(o.id));

  if (currentOffer) {
    return (
      <OfferScreen
        offer={currentOffer}
        onAccepted={(order) => {
          setActiveJob(order);
        }}
        onDeclined={() => setDismissedIds((s) => new Set(s).add(currentOffer.id))}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3.5 px-4 pb-6 pt-3.5">
      <ScreenTitle title="Jobs" subtitle="On duty · looking for offers" tone="on" />
      <DutyCard onDuty busy={togglingDuty} onToggle={handleToggleDuty} />
      <CashPausedNotice />
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex flex-col items-center gap-2 rounded-[14px] px-[18px] py-8 text-center shadow-[inset_0_0_0_1px_rgb(var(--c-line))]">
        <span className="h-9 w-9 animate-spin rounded-full border-4 border-line border-t-accent" aria-hidden="true" />
        <span className="font-semibold text-ink">Waiting for a job</span>
        <span className="text-[13px] leading-normal text-muted">You&apos;ll see an offer here as soon as one opens up nearby.</span>
      </div>
    </div>
  );
}

/**
 * US-R-08 — over the cash limit, the API stops offering cash-on-delivery
 * jobs (dispatch/service.ts), so a rider would just see fewer jobs with no
 * explanation. Fetched fresh each time this waiting screen mounts, which
 * includes right after finishing a delivery — exactly when a COD balance
 * can have just crossed the limit. Renders nothing when under it.
 */
function CashPausedNotice() {
  const [earnings, setEarnings] = useState<RiderEarningsDto | null>(null);

  useEffect(() => {
    dispatchApi.getEarnings().then(setEarnings).catch(() => {}); // purely informational — never worth surfacing an error over
  }, []);

  if (!earnings || earnings.cashFloatLimitMinor == null || earnings.cashBalanceMinor <= earnings.cashFloatLimitMinor) return null;

  return (
    <div className="w-full rounded-[14px] bg-danger/10 p-3.5 text-left shadow-[inset_0_0_0_1px_rgb(var(--c-danger)/0.3)]">
      <p className="text-sm font-semibold text-danger">Cash-on-delivery jobs are paused</p>
      <p className="mt-0.5 text-xs text-ink">
        You owe {formatNaira(minor(earnings.cashBalanceMinor))}, over your {formatNaira(minor(earnings.cashFloatLimitMinor))} limit.
        Hand the cash back to CloseBuy — prepaid jobs still come through.
      </p>
      <Link href="/earnings" className="mt-1 inline-block text-xs font-medium text-primary underline">
        See your balance
      </Link>
    </div>
  );
}

/**
 * US-R-03. No countdown timer here, deliberately, even though
 * screens-navigation.md §3.1 sketches one — the open-pool model
 * (dispatch/service.ts) has no per-rider reservation or deadline behind
 * it; any on-duty rider can claim any open job at any time, first to
 * accept wins. A fake countdown would imply an exclusivity that isn't
 * real.
 */
function OfferScreen({
  offer,
  onAccepted,
  onDeclined,
}: {
  offer: RiderJobDto;
  onAccepted: (order: RiderJobDto) => void;
  onDeclined: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAccept() {
    setError(null);
    setBusy(true);
    try {
      const res = await dispatchApi.acceptOffer(offer.id);
      onAccepted(res.order);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "That job is no longer available.");
      setBusy(false);
    }
  }

  async function handleDecline() {
    dispatchApi.declineOffer(offer.id).catch(() => {}); // no-op server-side (US-R-03) — just moves on locally
    onDeclined();
  }

  return (
    <div className="flex flex-col gap-3.5 px-4 pb-6 pt-3.5">
      <ScreenTitle title="Jobs" subtitle="On duty · 1 offer nearby" tone="on" />
      <article className="flex flex-col gap-3 rounded-[14px] bg-card p-3.5 shadow-[inset_0_0_0_2px_#FF5A19]">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[22px] font-semibold text-ink">{formatNaira(minor(offer.deliveryFeeMinor))}</span>
          <span className="rounded-md bg-raised px-1.5 py-0.5 font-mono text-[11px] uppercase text-muted">New job</span>
        </div>
        <div className="grid grid-cols-[14px_1fr] gap-x-2.5 gap-y-2 text-[13px]">
          <span className="mt-1 h-2.5 w-2.5 rounded-[3px] bg-primary" />
          <span>
            <span className="font-mono text-[10px] uppercase text-muted">Pickup</span>
            <br />
            <span className="font-medium text-ink">{offer.vendor.businessName}</span> · {offer.vendor.pickupLandmark}
          </span>
          <span className="mt-1 h-2.5 w-2.5 rounded-full bg-accent" />
          <span>
            <span className="font-mono text-[10px] uppercase text-muted">Drop-off</span>
            <br />
            {offer.deliveryLandmark}
          </span>
        </div>
        {offer.paymentMethod === "cash_on_delivery" && (
          <span className="self-start rounded-md bg-warning/15 px-2 py-1 font-mono text-[11px] uppercase text-warning">Collect {formatNaira(minor(offer.totalMinor))} cash</span>
        )}
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleDecline}
            disabled={busy}
            className="flex h-11 flex-1 items-center justify-center rounded-[10px] text-[13px] text-ink shadow-[inset_0_0_0_1px_rgb(var(--c-line))] disabled:opacity-50"
          >
            Skip
          </button>
          <button
            type="button"
            onClick={handleAccept}
            disabled={busy}
            className="flex h-11 flex-[2] items-center justify-center rounded-[10px] bg-accent text-sm font-semibold text-night transition-transform active:scale-[0.98] disabled:opacity-60"
          >
            {busy ? "Accepting…" : "Accept job"}
          </button>
        </div>
      </article>
    </div>
  );
}

function ActiveJob({ order, onChanged, onFailed }: { order: RiderJobDto; onChanged: () => void; onFailed: (order: RiderJobDto) => void }) {
  return order.status === "RIDER_ASSIGNED" ? (
    <PickupStep order={order} onChanged={onChanged} />
  ) : (
    <DeliveryStep order={order} onChanged={onChanged} onFailed={onFailed} />
  );
}

/** US-R-06's own acceptance criterion: after a failed delivery, the rider is instructed whether to return the goods — every current failure reason (customer unreachable, wrong address, customer refused, other) leaves the rider still physically holding them with nowhere else they can reasonably go, so this always points back to the vendor rather than branching on the reason. Acknowledging here is local UI state only — nothing server-side tracks "returned" (no field exists for it), so this never claims to have recorded anything it hasn't. */
function ReturnGoodsScreen({ order, onDone }: { order: RiderJobDto; onDone: () => void }) {
  return (
    <div className="flex flex-col gap-3.5 px-4 pb-6 pt-3.5">
      <p className="font-mono text-[11px] uppercase tracking-[0.06em] text-danger">Delivery reported failed</p>

      <div className="rounded-[14px] bg-card p-4 shadow-[inset_0_0_0_1px_rgb(var(--c-danger))]">
        <p className="text-lg font-semibold text-ink">Return these goods to {order.vendor.businessName}</p>
        <p className="mt-1 text-sm text-muted">
          This order couldn&apos;t be delivered. Take what you&apos;re carrying back to the vendor now — don&apos;t
          attempt the delivery again without a new job offer.
        </p>
        <p className="mt-3 text-sm text-ink">{order.vendor.pickupLandmark}</p>
        <div className="mt-3 flex gap-2">
          <LinkButton href={mapsLink(order.vendor.pickupLat, order.vendor.pickupLng)} target="_blank" rel="noreferrer" className="flex-1">
            Navigate
          </LinkButton>
          <LinkButton href={`tel:${order.vendor.pickupPhone}`} className="flex-1">
            Call
          </LinkButton>
        </div>
      </div>

      <Button onClick={onDone}>I&apos;ve returned the goods</Button>
    </div>
  );
}

function PickupStep({ order, onChanged }: { order: RiderJobDto; onChanged: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await dispatchApi.confirmCollection(order.id, { code });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Couldn't confirm collection.");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3.5 px-4 pb-6 pt-3.5">
      <p className="font-mono text-[11px] uppercase tracking-[0.06em] text-accent">Step 1 of 2 — Pick up</p>

      <div className="rounded-[14px] bg-card shadow-[inset_0_0_0_1px_rgb(var(--c-line))] p-4">
        <p className="text-lg font-semibold tracking-[-0.01em] text-ink">{order.vendor.businessName}</p>
        <p className="text-sm text-muted">{order.vendor.pickupLandmark}</p>
        <div className="mt-3 flex gap-2">
          <LinkButton href={mapsLink(order.vendor.pickupLat, order.vendor.pickupLng)} target="_blank" rel="noreferrer" className="flex-1">
            Navigate
          </LinkButton>
          <LinkButton href={`tel:${order.vendor.pickupPhone}`} className="flex-1">
            Call
          </LinkButton>
        </div>
      </div>

      <form onSubmit={handleConfirm} className="flex flex-col gap-3">
        <Input
          label="Collection code (ask the vendor to read it out)"
          inputMode="numeric"
          maxLength={4}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
        />
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button type="submit" disabled={busy || code.length !== 4}>
          {busy ? "Confirming…" : "Confirm collection"}
        </Button>
      </form>
    </div>
  );
}

function DeliveryStep({ order, onChanged, onFailed }: { order: RiderJobDto; onChanged: () => void; onFailed: (order: RiderJobDto) => void }) {
  const [recipientName, setRecipientName] = useState("");
  const [code, setCode] = useState("");
  const [cashCollected, setCashCollected] = useState("");
  const [reportingFailed, setReportingFailed] = useState(false);
  const [failReason, setFailReason] = useState<"customer_unreachable" | "wrong_address" | "customer_refused" | "other">("customer_unreachable");
  const [failNotes, setFailNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCod = order.paymentMethod === "cash_on_delivery";

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (code.trim().length !== 4) {
      setError("Ask the customer to read out their 4-digit code — it has to match before you can confirm.");
      return;
    }
    const cashCollectedMinor = isCod ? Math.round(Number(cashCollected) * 100) : undefined;
    if (isCod && (!Number.isFinite(cashCollectedMinor) || cashCollectedMinor === undefined)) {
      setError("Enter the cash amount you collected.");
      return;
    }

    setBusy(true);
    try {
      await dispatchApi.confirmDelivery(order.id, {
        recipientName: recipientName.trim() || undefined,
        code: code.trim(),
        cashCollectedMinor,
      });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Couldn't confirm delivery.");
      setBusy(false);
    }
  }

  async function handleReportFailed(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await dispatchApi.reportDeliveryFailed(order.id, { reason: failReason, notes: failNotes.trim() || undefined });
      onFailed(order); // not onChanged() — the parent needs this exact order to show the return-goods screen, and getActiveJob() won't have it anymore
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Couldn't report this.");
      setBusy(false);
    }
  }

  if (reportingFailed) {
    return (
      <form onSubmit={handleReportFailed} className="flex flex-col gap-3.5 px-4 pb-6 pt-3.5">
        <p className="text-lg font-semibold text-ink">Report delivery failed</p>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-ink">Reason</label>
          <select
            value={failReason}
            onChange={(e) => setFailReason(e.target.value as typeof failReason)}
            className="rounded-xl border border-line bg-card px-3 py-2.5 text-sm text-ink outline-none focus:border-primary focus:ring-4 focus:ring-primary/10"
          >
            <option value="customer_unreachable">Customer unreachable</option>
            <option value="wrong_address">Wrong address</option>
            <option value="customer_refused">Customer refused</option>
            <option value="other">Other</option>
          </select>
        </div>
        <Input label="Notes (optional)" value={failNotes} onChange={(e) => setFailNotes(e.target.value)} />
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button type="submit" variant="danger" disabled={busy}>
          {busy ? "Reporting…" : "Confirm failure"}
        </Button>
        <Button type="button" variant="secondary" onClick={() => setReportingFailed(false)}>
          Back
        </Button>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-3.5 px-4 pb-6 pt-3.5">
      <p className="font-mono text-[11px] uppercase tracking-[0.06em] text-accent">Step 2 of 2 — Deliver</p>

      <div className="rounded-[14px] bg-card shadow-[inset_0_0_0_1px_rgb(var(--c-line))] p-4">
        <p className="text-lg font-semibold text-ink">{order.deliveryLandmark}</p>
        <div className="mt-3 flex gap-2">
          <LinkButton href={mapsLink(order.deliveryLat, order.deliveryLng)} target="_blank" rel="noreferrer" className="flex-1">
            Navigate
          </LinkButton>
          <LinkButton href={`tel:${order.contactPhone}`} className="flex-1">
            Call
          </LinkButton>
        </div>
      </div>

      {isCod && (
        <p className="rounded-lg bg-warning/10 p-3 text-center text-sm text-warning">
          Collect {formatNaira(minor(order.totalMinor))} cash
        </p>
      )}

      <form onSubmit={handleConfirm} className="flex flex-col gap-3">
        <Input
          label="Confirmation code (ask the customer to read it out)"
          inputMode="numeric"
          maxLength={4}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
        />
        <Input label="Recipient's name (optional)" value={recipientName} onChange={(e) => setRecipientName(e.target.value)} />
        {isCod && (
          <Input
            label="Cash collected (₦)"
            inputMode="decimal"
            value={cashCollected}
            onChange={(e) => setCashCollected(e.target.value)}
            required
          />
        )}
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button type="submit" disabled={busy || code.length !== 4}>
          {busy ? "Confirming…" : "Confirm delivery"}
        </Button>
        <button type="button" onClick={() => setReportingFailed(true)} className="text-xs text-muted underline">
          Couldn&apos;t get the code? Report a failed delivery
        </button>
      </form>
    </div>
  );
}
