"use client";

import { useEffect, useState } from "react";
import { ApiClientError } from "@closebuy/api-client";
import { formatNaira, minor } from "@closebuy/types";
import type { VendorEarningsDto, PayoutDto, PayoutStatus, OwnVendorProfileDto } from "@closebuy/types";
import { orderApi, payoutsApi } from "@/lib/api";
import { VendorGate } from "@/components/VendorGate";
import { PageHeader } from "@/components/PageHeader";

const STATUS_LABEL: Record<PayoutStatus, string> = {
  requested: "Requested",
  scheduled: "Scheduled",
  paid: "Paid",
  failed: "Failed",
  rejected: "Rejected",
};
const STATUS_TONE: Record<PayoutStatus, "success" | "warning" | "danger"> = {
  requested: "warning",
  scheduled: "warning",
  paid: "success",
  failed: "danger",
  rejected: "danger",
};
const TONE_CLASSES = {
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  danger: "bg-danger/10 text-danger",
};

/** screens-navigation.md §2.4 — US-V-07. */
export default function EarningsPage() {
  return <VendorGate>{(vendor, refetch) => <Earnings vendor={vendor} refetch={refetch} />}</VendorGate>;
}

function Earnings({ vendor, refetch }: { vendor: OwnVendorProfileDto; refetch: () => void }) {
  const [earnings, setEarnings] = useState<VendorEarningsDto | null>(null);
  const [payouts, setPayouts] = useState<PayoutDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [payoutsError, setPayoutsError] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [isRequesting, setIsRequesting] = useState(false);

  function loadPayouts() {
    payoutsApi
      .listMyPayouts()
      .then((res) => setPayouts(res.payouts))
      .catch((err) => setPayoutsError(err instanceof ApiClientError ? err.message : "Couldn't load your payout history."));
  }

  useEffect(() => {
    orderApi
      .getVendorEarnings()
      .then(setEarnings)
      .catch((err) => setError(err instanceof ApiClientError ? err.message : "Couldn't load your earnings."));
    loadPayouts();
  }, []);

  async function handleRequestPayout() {
    setRequestError(null);
    setIsRequesting(true);
    try {
      // Omitted amount = the full available balance (payoutRequestSchema).
      await payoutsApi.requestPayout({});
      loadPayouts();
      orderApi.getVendorEarnings().then(setEarnings).catch(() => {});
    } catch (err) {
      setRequestError(err instanceof ApiClientError ? err.message : "Couldn't request a payout.");
    } finally {
      setIsRequesting(false);
    }
  }

  if (error) {
    return (
      <div className="p-4">
        <p className="text-sm text-danger">{error}</p>
      </div>
    );
  }
  if (!earnings) {
    return (
      <div className="p-4">
        <p className="text-sm text-muted">Loading…</p>
      </div>
    );
  }

  const waivedUntil = earnings.foundingVendorCommissionWaivedUntil
    ? new Date(earnings.foundingVendorCommissionWaivedUntil)
    : null;
  const waiverActive = waivedUntil !== null && waivedUntil.getTime() > Date.now();

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <PageHeader title="Earnings" subtitle="Balance · payouts · history" vendor={vendor} onVendorChanged={refetch} />

      {waiverActive && (
        <div className="rounded-xl bg-accent/10 p-3 text-sm text-ink">
          <span className="font-semibold text-accent">Founding Vendor:</span> 0% commission until{" "}
          {waivedUntil!.toLocaleDateString()}.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-[14px] bg-card shadow-[inset_0_0_0_1px_rgb(var(--c-line))] p-3">
          <p className="font-mono text-[10px] uppercase text-muted">Cleared</p>
          <p className="font-mono text-xl font-semibold text-success">{formatNaira(minor(earnings.clearedMinor))}</p>
        </div>
        <div className="rounded-[14px] bg-card shadow-[inset_0_0_0_1px_rgb(var(--c-line))] p-3">
          <p className="font-mono text-[10px] uppercase text-muted">Pending (estimate)</p>
          <p className="font-mono text-xl font-semibold text-warning">{formatNaira(minor(earnings.pendingMinor))}</p>
        </div>
      </div>
      <p className="-mt-2 text-xs text-muted">
        Pending is a gross estimate — commission is only final once an order completes with no dispute.
      </p>

      <div className="flex items-center justify-between rounded-[14px] bg-card shadow-[inset_0_0_0_1px_rgb(var(--c-line))] p-3">
        <div>
          <p className="font-mono text-[10px] uppercase text-muted">Available to withdraw</p>
          <p className="font-mono text-2xl font-semibold text-ink">{formatNaira(minor(earnings.availableToWithdrawMinor))}</p>
        </div>
        <button
          type="button"
          onClick={handleRequestPayout}
          disabled={isRequesting || earnings.availableToWithdrawMinor <= 0}
          className="flex h-11 items-center rounded-xl bg-accent px-5 text-sm font-semibold text-night transition-transform active:scale-[0.98] disabled:opacity-50"
        >
          {isRequesting ? "Requesting…" : "Request payout"}
        </button>
      </div>
      {requestError && <p className="-mt-2 text-sm text-danger">{requestError}</p>}

      <div className="flex flex-col gap-2">
        <p className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">Completed orders</p>
        {earnings.orders.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">Nothing completed yet.</p>
        ) : (
          <div className="flex flex-col divide-y divide-line rounded-[14px] bg-card shadow-[inset_0_0_0_1px_rgb(var(--c-line))]">
            {earnings.orders.map((o) => (
              <div key={o.orderId} className="flex items-center justify-between p-3 text-sm">
                <div>
                  <p className="text-ink">{new Date(o.completedAt).toLocaleDateString()}</p>
                  <p className="text-xs text-muted">
                    Gross {formatNaira(minor(o.grossMinor))} − commission {formatNaira(minor(o.commissionMinor))}
                  </p>
                </div>
                <p className="font-semibold text-ink">{formatNaira(minor(o.netMinor))}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <p className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">Payout history</p>
        {payoutsError ? (
          <p className="text-sm text-danger">{payoutsError}</p>
        ) : payouts === null ? (
          <p className="py-4 text-center text-sm text-muted">Loading…</p>
        ) : payouts.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">No payout requests yet.</p>
        ) : (
          <div className="flex flex-col divide-y divide-line rounded-[14px] bg-card shadow-[inset_0_0_0_1px_rgb(var(--c-line))]">
            {payouts.map((p) => (
              <div key={p.id} className="flex items-center justify-between p-3 text-sm">
                <div>
                  <p className="text-ink">{new Date(p.createdAt).toLocaleDateString()}</p>
                  <p className="text-xs text-muted">
                    {p.reference ?? "No reference yet"}
                    {(p.status === "failed" && p.failureReason) || (p.status === "rejected" && p.rejectionReason)
                      ? ` — ${p.failureReason ?? p.rejectionReason}`
                      : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${TONE_CLASSES[STATUS_TONE[p.status]]}`}>
                    {STATUS_LABEL[p.status]}
                  </span>
                  <p className="font-semibold text-ink">{formatNaira(minor(p.amountMinor))}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
