"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Button, Card, Input, useAuthSession } from "@closebuy/ui";
import { ApiClientError } from "@closebuy/api-client";
import { formatNaira, minor, DISPUTE_RESOLUTIONS } from "@closebuy/types";
import type { AdminDisputeDto, DisputeResolution } from "@closebuy/types";
import { adminApi } from "@/lib/api";

const resolutionCopy: Record<DisputeResolution, string> = {
  full_refund: "Full refund — reverses the entire order amount to the customer; vendor and rider receive nothing.",
  partial_refund: "Partial refund — reverses only the amount below to the customer; the rest releases normally.",
  rejected: "Reject — no refund; the order's escrow releases in full, same as if no dispute had been opened.",
};

/** screens-navigation.md §4.3 — US-A-04. Order context, customer evidence, and the three resolution actions. */
export default function DisputeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { session, isLoaded } = useAuthSession();

  const [dispute, setDispute] = useState<AdminDisputeDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [resolution, setResolution] = useState<DisputeResolution | "">("");
  const [amountNaira, setAmountNaira] = useState("");
  const [reason, setReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isLoaded && !session) router.push("/login");
  }, [isLoaded, session, router]);

  function load() {
    adminApi
      .getDispute(id)
      .then((res) => setDispute(res.dispute))
      .catch((err) => setLoadError(err instanceof ApiClientError ? err.message : "Couldn't load this dispute."));
  }

  useEffect(() => {
    if (!session) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, id]);

  if (!isLoaded || !session) return null;
  if (loadError) return <p className="text-sm text-danger">{loadError}</p>;
  if (!dispute) return <p className="text-sm text-muted">Loading…</p>;

  async function handleResolve() {
    if (!resolution || !reason.trim()) return;
    const amountMinor = resolution === "partial_refund" ? Math.round(parseFloat(amountNaira) * 100) : undefined;
    if (resolution === "partial_refund" && (!amountMinor || amountMinor <= 0)) return;

    setIsSubmitting(true);
    setActionError(null);
    try {
      await adminApi.resolveDispute(id, { resolution, amountMinor, reason: reason.trim() });
      load();
    } catch (err) {
      setActionError(err instanceof ApiClientError ? err.message : "That resolution didn't go through.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link href="/disputes" className="text-sm text-muted underline">← All disputes</Link>
        <h1 className="mt-1 text-xl font-bold text-ink">Dispute on order {dispute.orderId.slice(0, 8)}</h1>
      </div>

      <Card className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
        <Info label="Vendor" value={dispute.order.vendor.businessName} />
        <Info label="Order status" value={dispute.order.status} />
        <Info label="Order total" value={formatNaira(minor(dispute.order.totalMinor))} />
        <Info label="Customer contact" value={dispute.order.contactPhone} />
        <Info label="Opened" value={new Date(dispute.createdAt).toLocaleString()} />
        <Info label="Dispute status" value={dispute.status} />
      </Card>

      <Card>
        <p className="mb-2 text-sm font-semibold text-ink">Customer&apos;s reason</p>
        <p className="text-sm text-ink">{dispute.reason}</p>
        {dispute.evidence.length > 0 && (
          <div className="mt-3 flex flex-col gap-1">
            <p className="text-xs text-muted">Evidence</p>
            {dispute.evidence.map((url, i) => (
              <a key={url} href={url} target="_blank" rel="noreferrer" className="text-sm text-primary underline">
                View evidence {i + 1}
              </a>
            ))}
          </div>
        )}
      </Card>

      <Card className="flex flex-col gap-3">
        <p className="text-sm font-semibold text-ink">Resolution (US-A-04)</p>

        {dispute.status === "resolved" ? (
          <div className="text-sm text-ink">
            <p>Resolved as <span className="font-medium">{dispute.resolution}</span> on {dispute.resolvedAt && new Date(dispute.resolvedAt).toLocaleString()}.</p>
          </div>
        ) : (
          <>
            {actionError && <p className="text-sm text-danger">{actionError}</p>}
            <div className="flex flex-col gap-2">
              {DISPUTE_RESOLUTIONS.map((r) => (
                <label key={r} className="flex items-start gap-2 text-sm text-ink">
                  <input
                    type="radio"
                    name="resolution"
                    value={r}
                    checked={resolution === r}
                    onChange={() => setResolution(r)}
                    className="mt-1"
                  />
                  <span>{resolutionCopy[r]}</span>
                </label>
              ))}
            </div>

            {resolution === "partial_refund" && (
              <Input
                label="Refund amount (₦)"
                type="number"
                min="0"
                step="0.01"
                value={amountNaira}
                onChange={(e) => setAmountNaira(e.target.value)}
                required
              />
            )}

            <Input
              label="Reason (required — written to the audit log, sent to both parties)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
            />

            <Button
              type="button"
              variant="danger"
              disabled={isSubmitting || !resolution || !reason.trim()}
              onClick={handleResolve}
            >
              {isSubmitting ? "Resolving…" : "Confirm resolution"}
            </Button>
          </>
        )}
      </Card>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className="text-ink">{value}</p>
    </div>
  );
}
