"use client";

import { useEffect, useState } from "react";
import { Placeholder } from "@closebuy/ui";
import { ApiClientError } from "@closebuy/api-client";
import { formatNaira, minor } from "@closebuy/types";
import type { VendorEarningsDto } from "@closebuy/types";
import { orderApi } from "@/lib/api";
import { VendorGate } from "@/components/VendorGate";

/**
 * screens-navigation.md §2.4 — US-V-07. Payout history isn't built —
 * there's no read endpoint over the `Payout` table for a vendor yet
 * (Admin's `POST /admin/payouts/run` is what would create those rows,
 * and that's not built either, api-contracts.md). Flagged, not faked.
 */
export default function EarningsPage() {
  return <VendorGate>{() => <Earnings />}</VendorGate>;
}

function Earnings() {
  const [earnings, setEarnings] = useState<VendorEarningsDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    orderApi
      .getVendorEarnings()
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

      <Placeholder title="Payout history" note="No payout-run mechanism exists yet (Admin's POST /admin/payouts/run isn't built) — nothing to list here honestly, not a hidden gap." />
    </div>
  );
}
