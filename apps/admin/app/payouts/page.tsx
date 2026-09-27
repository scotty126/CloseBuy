"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Input, useAuthSession } from "@closebuy/ui";
import { ApiClientError } from "@closebuy/api-client";
import { formatNaira, minor } from "@closebuy/types";
import type { PendingPayoutRequest, ReconciliationReportDto, ReconciliationDiscrepancy } from "@closebuy/types";
import { adminApi } from "@/lib/api";
import { formatWholeNaira } from "@/lib/format";

const ACCOUNT_LABEL: Record<string, string> = {
  platform_clearing: "Platform clearing",
  customer_escrow: "Customer escrow",
  vendor_payable: "Vendor payable",
  platform_commission: "Platform commission",
  rider_payable: "Rider payable",
  rider_cash_float: "Rider cash float",
};

const PAYOUT_STATUS_LABEL: Record<string, string> = {
  requested: "Requested",
  scheduled: "Scheduled",
  paid: "Paid",
  failed: "Failed",
  rejected: "Rejected",
};

/**
 * screens-navigation.md §4.5, US-A-05. Two real, separate things that share
 * one nav entry ("Payouts & reconciliation") because the original sketch
 * put them there: the payout-approval queue (a real, working API —
 * ../payouts/routes.js — that had genuinely never had a screen in front of
 * it before this) and the reconciliation report (US-A-05's other half,
 * apps/api/src/modules/admin/reconciliation.ts — brand new).
 */
export default function PayoutsPage() {
  const router = useRouter();
  const { session, isLoaded } = useAuthSession();

  const [requests, setRequests] = useState<PendingPayoutRequest[] | null>(null);
  const [requestsError, setRequestsError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null); // payout id whose reject-reason form is open
  const [reason, setReason] = useState("");

  const [report, setReport] = useState<ReconciliationReportDto | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportLoading, setReportLoading] = useState(false);

  useEffect(() => {
    if (isLoaded && !session) router.push("/login");
  }, [isLoaded, session, router]);

  function loadRequests() {
    adminApi
      .listPayoutRequests()
      .then((res) => setRequests(res.requests))
      .catch((err) => setRequestsError(err instanceof ApiClientError ? err.message : "Couldn't load payout requests."));
  }

  function loadReport() {
    setReportLoading(true);
    setReportError(null);
    adminApi
      .getReconciliationReport()
      .then(setReport)
      .catch((err) => setReportError(err instanceof ApiClientError ? err.message : "Couldn't load the reconciliation report."))
      .finally(() => setReportLoading(false));
  }

  useEffect(() => {
    if (!session) return;
    loadRequests();
    loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  if (!isLoaded || !session) return null;

  async function handleApprove(payoutId: string) {
    setActingId(payoutId);
    setActionError(null);
    try {
      const res = await adminApi.approvePayout(payoutId);
      // "failed" is a normal, expected real outcome right now (Monnify isn't configured) — the request still
      // leaves the queue (it's been decided), so this isn't an error path, just a result worth surfacing.
      setRequests((prev) => prev?.filter((r) => r.id !== payoutId) ?? prev);
      if (res.payout.status === "failed") {
        setActionError(`Approved, but the transfer failed: ${res.payout.failureReason ?? "unknown reason"}`);
      }
      loadReport(); // payout totals just changed
    } catch (err) {
      setActionError(err instanceof ApiClientError ? err.message : "That didn't go through.");
    } finally {
      setActingId(null);
    }
  }

  async function handleReject(payoutId: string) {
    if (!reason.trim()) return;
    setActingId(payoutId);
    setActionError(null);
    try {
      await adminApi.rejectPayout(payoutId, { reason: reason.trim() });
      setRequests((prev) => prev?.filter((r) => r.id !== payoutId) ?? prev);
      setRejecting(null);
      setReason("");
      loadReport();
    } catch (err) {
      setActionError(err instanceof ApiClientError ? err.message : "That didn't go through.");
    } finally {
      setActingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-xl font-bold text-ink">Payouts & reconciliation</h1>
        <p className="text-sm text-muted">
          Admin never pushes money unprompted — a vendor requests a withdrawal, you review and approve or reject it
          (US-A-05). Reconciliation below checks the books balance, independent of any single payout.
        </p>
      </div>

      {/* ── Payout requests ──────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Pending payout requests</h2>
        {requestsError && <p className="text-sm text-danger">{requestsError}</p>}
        {actionError && <p className="text-sm text-danger">{actionError}</p>}

        {requests === null && !requestsError ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : requests && requests.length === 0 ? (
          <Card>
            <p className="text-sm text-muted">No vendor is currently waiting on a payout decision.</p>
          </Card>
        ) : (
          <div className="flex flex-col gap-3">
            {requests?.map((r) => (
              <Card key={r.id} className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-base font-semibold text-ink">{r.vendor.businessName}</p>
                    <p className="text-xs text-muted">Requested {new Date(r.createdAt).toLocaleString()}</p>
                  </div>
                  <p className="text-lg font-semibold text-ink">{formatNaira(minor(r.amountMinor))}</p>
                </div>

                {rejecting === r.id ? (
                  <div className="flex flex-col gap-2 border-t border-gray-200 pt-3">
                    <Input
                      label="Reason for rejection (written to the audit log, sent to the vendor)"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      required
                    />
                    <div className="flex gap-2">
                      <Button type="button" variant="danger" disabled={actingId === r.id || !reason.trim()} onClick={() => handleReject(r.id)}>
                        {actingId === r.id ? "Working…" : "Confirm rejection"}
                      </Button>
                      <Button type="button" variant="secondary" onClick={() => { setRejecting(null); setReason(""); }}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Button type="button" disabled={actingId === r.id} onClick={() => handleApprove(r.id)}>
                      {actingId === r.id ? "Working…" : "Approve"}
                    </Button>
                    <Button type="button" variant="danger" disabled={actingId === r.id} onClick={() => { setRejecting(r.id); setReason(""); }}>
                      Reject
                    </Button>
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* ── Reconciliation ───────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Reconciliation</h2>
          <button type="button" onClick={loadReport} disabled={reportLoading} className="text-xs font-medium text-primary underline disabled:opacity-50">
            {reportLoading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        {reportError && <p className="text-sm text-danger">{reportError}</p>}

        {!report && !reportError ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : report ? (
          <div className="flex flex-col gap-4">
            <p className="text-xs text-muted">As of {new Date(report.generatedAt).toLocaleString()} — lifetime totals, not a date range.</p>

            <DiscrepancyPanel discrepancies={report.discrepancies} />

            <Card className="flex flex-col gap-2">
              <p className="text-sm font-medium text-ink">Ledger totals, by account</p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[32rem] text-left text-sm">
                  <thead className="text-xs uppercase text-muted">
                    <tr>
                      <th className="py-1 pr-3 font-medium">Account</th>
                      <th className="py-1 pr-3 text-right font-medium">Debit</th>
                      <th className="py-1 pr-3 text-right font-medium">Credit</th>
                      <th className="py-1 text-right font-medium">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.ledgerByAccount.map((a) => (
                      <tr key={a.account} className="border-t border-gray-100">
                        <td className="py-1.5 pr-3 text-ink">{ACCOUNT_LABEL[a.account] ?? a.account}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums text-muted">{formatWholeNaira(a.debitMinor)}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums text-muted">{formatWholeNaira(a.creditMinor)}</td>
                        <td className="py-1.5 text-right tabular-nums font-medium text-ink">{formatWholeNaira(a.netMinor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {Object.entries(report.payoutTotals).map(([status, t]) => (
                <Tile key={status} label={`Payouts — ${PAYOUT_STATUS_LABEL[status] ?? status}`} value={formatWholeNaira(t!.amountMinor)} note={`${t!.count} payout${t!.count === 1 ? "" : "s"}`} />
              ))}
              <Tile label="Rider cash remitted" value={formatWholeNaira(report.remittanceTotalMinor)} note="Lifetime, across every rider" />
            </div>

            <Card className="flex flex-col gap-1">
              <p className="text-sm font-medium text-ink">Gateway settlement vs. ledger</p>
              <p className="text-sm text-muted">{report.gatewaySettlement.reason}</p>
            </Card>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function DiscrepancyPanel({ discrepancies }: { discrepancies: ReconciliationDiscrepancy[] }) {
  if (discrepancies.length === 0) {
    return (
      <Card className="border-success/30 bg-success/5">
        <p className="text-sm font-medium text-ink">No discrepancies found — the books check out.</p>
      </Card>
    );
  }
  return (
    <Card className="flex flex-col gap-3 border-danger/30 bg-danger/5">
      <p className="text-sm font-semibold text-danger">
        {discrepancies.length} discrepanc{discrepancies.length === 1 ? "y" : "ies"} found — real money, investigate before trusting any balance above.
      </p>
      {discrepancies.map((d, i) => (
        <div key={i} className="rounded-lg bg-white p-3 text-sm">
          <p className="font-medium text-ink">{d.message}</p>
          <dl className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted">
            {Object.entries(d.details).map(([k, v]) => (
              <div key={k} className="flex gap-1">
                <dt className="font-medium">{k}:</dt>
                <dd className="tabular-nums">{formatWholeNaira(v)}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </Card>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="text-2xl font-semibold text-ink">{value}</p>
      <p className="text-xs text-muted">{note}</p>
    </div>
  );
}
