"use client";

import { useEffect, useState } from "react";
import { Button } from "@closebuy/ui";
import { ApiClientError } from "@closebuy/api-client";
import { formatNaira, minor } from "@closebuy/types";
import type { VendorEarningsDto, PayoutDto, PayoutStatus } from "@closebuy/types";
import { orderApi, payoutsApi } from "@/lib/api";
import { VendorGate } from "@/components/VendorGate";

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
  return <VendorGate>{() => <Earnings />}</VendorGate>;
}

function Earnings() {
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
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-lg font-bold text-ink">Earnings</h1>

      {waiverActive && (
        <div className="rounded-xl bg-accent/10 p-3 text-sm text-ink">
          <span className="font-semibold text-accent">Founding Vendor:</span> 0% commission until{" "}
          {waivedUntil!.toLocaleDateString()}.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-gray-200 bg-white p-3">
          <p className="text-xs text-muted">Cleared</p>
          <p className="text-lg font-semibold text-success">{formatNaira(minor(earnings.clearedMinor))}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-3">
          <p className="text-xs text-muted">Pending (estimate)</p>
          <p className="text-lg font-semibold text-warning">{formatNaira(minor(earnings.pendingMinor))}</p>
        </div>
      </div>
      <p className="-mt-2 text-xs text-muted">
        Pending is a gross estimate — commission is only final once an order completes with no dispute.
      </p>

      <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white p-3">
        <div>
          <p className="text-xs text-muted">Available to withdraw</p>
          <p className="text-lg font-semibold text-ink">{formatNaira(minor(earnings.availableToWithdrawMinor))}</p>
        </div>
        <Button onClick={handleRequestPayout} disabled={isRequesting || earnings.availableToWithdrawMinor <= 0}>
          {isRequesting ? "Requesting…" : "Request payout"}
        </Button>
      </div>
      {requestError && <p className="-mt-2 text-sm text-danger">{requestError}</p>}

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-ink">Completed orders</p>
        {earnings.orders.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">Nothing completed yet.</p>
        ) : (
          <div className="flex flex-col divide-y divide-gray-200 rounded-xl border border-gray-200 bg-white">
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
        <p className="text-sm font-medium text-ink">Payout history</p>
        {payoutsError ? (
          <p className="text-sm text-danger">{payoutsError}</p>
        ) : payouts === null ? (
          <p className="py-4 text-center text-sm text-muted">Loading…</p>
        ) : payouts.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">No payout requests yet.</p>
        ) : (
          <div className="flex flex-col divide-y divide-gray-200 rounded-xl border border-gray-200 bg-white">
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
