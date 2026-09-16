"use client";

import { useEffect, useState } from "react";
import { Button, Input } from "@closebuy/ui";
import { ApiClientError } from "@closebuy/api-client";
import { formatNaira, minor } from "@closebuy/types";
import type { RiderProfileDto, RiderJobDto } from "@closebuy/types";
import { dispatchApi } from "@/lib/api";
import { RiderGate } from "@/components/RiderGate";
import { LinkButton } from "@/components/LinkButton";

const POLL_MS = 5000; // faster than the vendor/customer 8s polls — a rider mid-shift needs the freshest read

function mapsLink(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
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
      <div className="flex min-h-[80vh] flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-lg font-semibold text-ink">You&apos;re off duty</p>
        <p className="text-sm text-muted">Go on duty to start seeing delivery jobs.</p>
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button onClick={handleToggleDuty} disabled={togglingDuty}>
          {togglingDuty ? "Going on duty…" : "Go on duty"}
        </Button>
      </div>
    );
  }

  if (activeJob) {
    return <ActiveJob order={activeJob} onChanged={load} />;
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
    <div className="flex min-h-[80vh] flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-lg font-semibold text-ink">On duty — waiting for a job</p>
      <p className="text-sm text-muted">You&apos;ll see an offer here as soon as one opens up nearby.</p>
      {error && <p className="text-sm text-danger">{error}</p>}
      <Button variant="secondary" onClick={handleToggleDuty} disabled={togglingDuty}>
        {togglingDuty ? "Going off duty…" : "Go off duty"}
      </Button>
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
    <div className="flex min-h-[80vh] flex-col justify-between gap-4 p-6">
      <div>
        <p className="text-center text-xs font-medium uppercase tracking-wide text-accent">New delivery job</p>
        <p className="mt-4 text-center text-2xl font-bold text-ink">{formatNaira(minor(offer.deliveryFeeMinor))}</p>
        <p className="text-center text-sm text-muted">Delivery fee</p>

        <div className="mt-6 flex flex-col gap-3">
          <div className="rounded-xl border border-gray-200 bg-white p-3">
            <p className="text-xs text-muted">Pick up from</p>
            <p className="font-medium text-ink">{offer.vendor.businessName}</p>
            <p className="text-sm text-muted">{offer.vendor.pickupLandmark}</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-3">
            <p className="text-xs text-muted">Deliver to</p>
            <p className="font-medium text-ink">{offer.deliveryLandmark}</p>
          </div>
          {offer.paymentMethod === "cash_on_delivery" && (
            <p className="text-center text-xs text-warning">Cash on delivery — collect {formatNaira(minor(offer.totalMinor))}</p>
          )}
        </div>
      </div>

      {error && <p className="text-center text-sm text-danger">{error}</p>}

      <div className="flex flex-col gap-2">
        <Button onClick={handleAccept} disabled={busy}>
          {busy ? "Accepting…" : "Accept"}
        </Button>
        <Button variant="secondary" onClick={handleDecline} disabled={busy}>
          Not this one
        </Button>
      </div>
    </div>
  );
}

function ActiveJob({ order, onChanged }: { order: RiderJobDto; onChanged: () => void }) {
  return order.status === "RIDER_ASSIGNED" ? (
    <PickupStep order={order} onChanged={onChanged} />
  ) : (
    <DeliveryStep order={order} onChanged={onChanged} />
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
    <div className="flex flex-col gap-4 p-6">
      <p className="text-xs font-medium uppercase tracking-wide text-accent">Step 1 of 2 — Pick up</p>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <p className="text-lg font-semibold text-ink">{order.vendor.businessName}</p>
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
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
        />
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button type="submit" disabled={busy || code.length !== 6}>
          {busy ? "Confirming…" : "Confirm collection"}
        </Button>
      </form>
    </div>
  );
}

function DeliveryStep({ order, onChanged }: { order: RiderJobDto; onChanged: () => void }) {
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

    if (code.trim().length !== 6) {
      setError("Ask the customer to read out their 6-digit code — it has to match before you can confirm.");
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
      onChanged();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Couldn't report this.");
      setBusy(false);
    }
  }

  if (reportingFailed) {
    return (
      <form onSubmit={handleReportFailed} className="flex flex-col gap-4 p-6">
        <p className="text-lg font-semibold text-ink">Report delivery failed</p>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-ink">Reason</label>
          <select
            value={failReason}
            onChange={(e) => setFailReason(e.target.value as typeof failReason)}
            className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
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
    <div className="flex flex-col gap-4 p-6">
      <p className="text-xs font-medium uppercase tracking-wide text-accent">Step 2 of 2 — Deliver</p>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
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
          maxLength={6}
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
        <Button type="submit" disabled={busy || code.length !== 6}>
          {busy ? "Confirming…" : "Confirm delivery"}
        </Button>
        <button type="button" onClick={() => setReportingFailed(true)} className="text-xs text-muted underline">
          Couldn&apos;t get the code? Report a failed delivery
        </button>
      </form>
    </div>
  );
}
