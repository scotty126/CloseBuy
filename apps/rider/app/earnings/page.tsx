"use client";

import { useEffect, useState } from "react";
import { Placeholder } from "@closebuy/ui";
import { ApiClientError } from "@closebuy/api-client";
import { formatNaira, minor } from "@closebuy/types";
import type { RiderEarningsDto } from "@closebuy/types";
import { dispatchApi } from "@/lib/api";
import { RiderGate } from "@/components/RiderGate";

/** screens-navigation.md §3.3 — US-R-07/08. Remit isn't built (open question: rider-initiated vs. admin-recorded, api-contracts.md) — the balance is shown honestly with no action attached to it. */
export default function EarningsPage() {
  return <RiderGate>{() => <Earnings />}</RiderGate>;
}

function Earnings() {
  const [earnings, setEarnings] = useState<RiderEarningsDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    dispatchApi
      .getEarnings()
      .then(setEarnings)
      .catch((err) => setError(err instanceof ApiClientError ? err.message : "Couldn't load your earnings."));
  }, []);

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

      {earnings.cashBalanceMinor > 0 && (
        <div className="rounded-xl bg-danger/10 p-3">
          <p className="text-xs text-danger">Cash owed to the platform (US-R-08)</p>
          <p className="text-lg font-semibold text-danger">{formatNaira(minor(earnings.cashBalanceMinor))}</p>
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

      <Placeholder title="Cash remittance" note="US-R-08 is still an open question (rider-initiated vs. admin-recorded, api-contracts.md) — no endpoint to build against yet." />
    </div>
  );
}
