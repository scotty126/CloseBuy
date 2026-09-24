"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, useAuthSession } from "@closebuy/ui";
import { ApiClientError } from "@closebuy/api-client";
import { formatNaira, minor, DISPUTE_STATUSES } from "@closebuy/types";
import type { AdminDisputeDto, DisputeStatus } from "@closebuy/types";
import { adminApi } from "@/lib/api";

const statusStyle: Record<DisputeStatus, string> = {
  open: "bg-warning/10 text-warning",
  resolved: "bg-success/10 text-success",
};

/** screens-navigation.md §4.3 — US-A-04. Queue with order history and evidence, resolved on the detail page. */
export default function DisputesPage() {
  const router = useRouter();
  const { session, isLoaded } = useAuthSession();

  const [disputes, setDisputes] = useState<AdminDisputeDto[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState<DisputeStatus | "">("open");

  useEffect(() => {
    if (isLoaded && !session) router.push("/login");
  }, [isLoaded, session, router]);

  useEffect(() => {
    if (!session) return;
    setDisputes(null);
    setLoadError(null);
    adminApi
      .listDisputes({ status: status || undefined })
      .then((res) => setDisputes(res.disputes))
      .catch((err) => setLoadError(err instanceof ApiClientError ? err.message : "Couldn't load disputes."));
  }, [session, status]);

  if (!isLoaded || !session) return null;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold text-ink">Disputes</h1>
        <p className="text-sm text-muted">
          Every order a customer has disputed, oldest first. Opening a dispute holds its escrow release (US-C-11)
          until resolved here — full refund, partial refund, or rejected (US-A-04).
        </p>
      </div>

      <div className="flex gap-3">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as DisputeStatus | "")}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">All disputes</option>
          {DISPUTE_STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {loadError && <p className="text-sm text-danger">{loadError}</p>}

      {disputes === null && !loadError ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : disputes && disputes.length === 0 ? (
        <Card><p className="text-sm text-muted">No disputes match this filter.</p></Card>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 bg-surface text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-2">Order</th>
                <th className="px-4 py-2">Vendor</th>
                <th className="px-4 py-2">Reason</th>
                <th className="px-4 py-2">Total</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Opened</th>
              </tr>
            </thead>
            <tbody>
              {disputes?.map((dispute) => (
                <tr key={dispute.id} className="border-b border-gray-100 last:border-0 hover:bg-surface">
                  <td className="px-4 py-2">
                    <Link href={`/disputes/${dispute.id}`} className="font-medium text-primary underline">
                      {dispute.orderId.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-ink">{dispute.order.vendor.businessName}</td>
                  <td className="max-w-xs truncate px-4 py-2 text-ink">{dispute.reason}</td>
                  <td className="px-4 py-2 text-ink">{formatNaira(minor(dispute.order.totalMinor))}</td>
                  <td className="px-4 py-2">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${statusStyle[dispute.status]}`}>
                      {dispute.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-muted">{new Date(dispute.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
