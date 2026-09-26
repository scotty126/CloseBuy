"use client";

import { useEffect, useState } from "react";
import { ApiClientError } from "@closebuy/api-client";
import { formatNaira, minor } from "@closebuy/types";
import type { RiderEarningsDto, RiderRemittanceDto } from "@closebuy/types";
import { dispatchApi } from "@/lib/api";
import { RiderGate } from "@/components/RiderGate";

/**
 * screens-navigation.md §3.3 — US-R-07/08. There's deliberately no "remit"
 * button: an admin records a remittance once the cash has actually been
 * handed over (US-R-08), and the balance drops here when they do. A rider
 * who could log their own handback would just be editing their own debt.
 */
export default function EarningsPage() {
  return <RiderGate>{() => <Earnings />}</RiderGate>;
}

function Earnings() {
  const [earnings, setEarnings] = useState<RiderEarningsDto | null>(null);
  const [remittances, setRemittances] = useState<RiderRemittanceDto[] | null>(null);
  const [remittancesError, setRemittancesError] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Independent loads: the balance is the part a rider can't do without, so
  // a failure fetching the history is reported in place rather than
  // blanking the whole screen (or, worse, shown as a false "none yet").
  useEffect(() => {
    dispatchApi
      .getEarnings()
      .then(setEarnings)
      .catch((err) => setError(err instanceof ApiClientError ? err.message : "Couldn't load your earnings."));
    dispatchApi
      .listRemittances()
      .then((r) => setRemittances(r.remittances))
      .catch(() => setRemittancesError(true));
  }, []);

  if (error) {
    return (
      <div className="p-4">
        <p className="text-sm text-danger">{error}</p>
      </div>
    );
  }
  if (!earnings || (!remittances && !remittancesError)) {
    return (
      <div className="p-4">
        <p className="text-sm text-muted">Loading…</p>
      </div>
    );
  }

  const owes = earnings.cashBalanceMinor > 0;
  // Same rule the API enforces (dispatch/service.ts): strictly over the limit.
  // `!= null`: tolerate an API that predates the limit (not redeployed yet) instead of rendering NaN.
  const limit = earnings.cashFloatLimitMinor;
  const overLimit = limit != null && earnings.cashBalanceMinor > limit;

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-lg font-bold text-ink">Earnings</h1>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-gray-200 bg-white p-3">
          <p className="text-xs text-muted">Cleared</p>
          <p className="text-lg font-semibold text-success">{formatNaira(minor(earnings.clearedMinor))}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-3">
          <p className="text-xs text-muted">Pending</p>
          <p className="text-lg font-semibold text-warning">{formatNaira(minor(earnings.pendingMinor))}</p>
        </div>
      </div>

      <div className={`rounded-xl p-3 ${owes ? "bg-danger/10" : "bg-success/10"}`}>
        <p className={`text-xs ${owes ? "text-danger" : "text-success"}`}>Cash you owe CloseBuy</p>
        <p className={`text-lg font-semibold ${owes ? "text-danger" : "text-success"}`}>
          {formatNaira(minor(earnings.cashBalanceMinor))}
        </p>
        <p className="mt-1 text-xs text-muted">
          {owes
            ? "Cash you collected on delivery. Hand it back to CloseBuy — once an admin records it, this drops and it shows in your history below."
            : "You're all clear — nothing collected on delivery is outstanding."}
        </p>
        {limit != null && <p className="mt-1 text-xs text-muted">Your cash limit: {formatNaira(minor(limit))}</p>}
      </div>

      {overLimit && (
        <div className="rounded-xl border border-danger/30 bg-danger/5 p-3">
          <p className="text-sm font-semibold text-danger">Cash-on-delivery jobs are paused</p>
          <p className="mt-0.5 text-xs text-ink">
            You&apos;re over your cash limit. You&apos;ll still see prepaid jobs; cash-on-delivery ones come back as soon as
            an admin records your remittance.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-ink">Deliveries</p>
        {earnings.deliveries.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">No completed deliveries yet.</p>
        ) : (
          <div className="flex flex-col divide-y divide-gray-200 rounded-xl border border-gray-200 bg-white">
            {earnings.deliveries.map((d) => (
              <div key={d.orderId} className="flex items-center justify-between p-3 text-sm">
                <p className="text-ink">{new Date(d.completedAt).toLocaleDateString()}</p>
                <p className="font-semibold text-ink">{formatNaira(minor(d.amountMinor))}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-ink">Cash handed back</p>
        {remittancesError || !remittances ? (
          <p className="py-6 text-center text-sm text-danger">Couldn&apos;t load your remittance history — try again shortly.</p>
        ) : remittances.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">No remittances recorded yet.</p>
        ) : (
          <div className="flex flex-col divide-y divide-gray-200 rounded-xl border border-gray-200 bg-white">
            {remittances.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                <div className="min-w-0">
                  <p className="text-ink">{new Date(r.createdAt).toLocaleDateString()}</p>
                  {r.note && <p className="truncate text-xs text-muted">{r.note}</p>}
                </div>
                <p className="shrink-0 font-semibold text-success">−{formatNaira(minor(r.amountMinor))}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
