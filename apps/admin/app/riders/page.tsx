"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Card, Input, useAuthSession } from "@closebuy/ui";
import { ApiClientError } from "@closebuy/api-client";
import type { AdminRiderDto, AdminOrderSummaryDto, RiderStatus } from "@closebuy/types";
import { adminApi } from "@/lib/api";

const statusStyle: Record<RiderStatus, string> = {
  pending: "bg-muted/10 text-muted",
  approved: "bg-success/10 text-success",
  suspended: "bg-danger/10 text-danger",
  rejected: "bg-danger/10 text-danger",
};

/** No dedicated screens-navigation.md entry yet — the rider side of US-A-06 (suspend an actor). Applications (§4.1) stays pending-only; this is every rider, any status. */
export default function RidersPage() {
  const router = useRouter();
  const { session, isLoaded } = useAuthSession();

  const [riders, setRiders] = useState<AdminRiderDto[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actingKey, setActingKey] = useState<string | null>(null); // reason form open for this rider id
  const [mode, setMode] = useState<"suspend" | "unsuspend" | null>(null);
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [inFlightByRider, setInFlightByRider] = useState<Record<string, AdminOrderSummaryDto[]>>({});

  useEffect(() => {
    if (isLoaded && !session) router.push("/login");
  }, [isLoaded, session, router]);

  useEffect(() => {
    if (!session) return;
    adminApi
      .listRiders()
      .then((res) => setRiders(res.riders))
      .catch((err) => setLoadError(err instanceof ApiClientError ? err.message : "Couldn't load riders."));
  }, [session]);

  if (!isLoaded || !session) return null;

  function openAction(riderId: string, actionMode: "suspend" | "unsuspend") {
    setActingKey(riderId);
    setMode(actionMode);
    setReason("");
    setActionError(null);
  }

  async function handleConfirm(rider: AdminRiderDto) {
    if (!reason.trim() || !mode) return;
    setIsSubmitting(true);
    setActionError(null);
    try {
      if (mode === "suspend") {
        const res = await adminApi.suspendRider(rider.id, { reason: reason.trim() });
        setRiders((prev) => prev?.map((r) => (r.id === rider.id ? res.rider : r)) ?? prev);
        setInFlightByRider((prev) => ({ ...prev, [rider.id]: res.inFlightOrders }));
      } else {
        const res = await adminApi.unsuspendRider(rider.id, { reason: reason.trim() });
        setRiders((prev) => prev?.map((r) => (r.id === rider.id ? res.rider : r)) ?? prev);
        setInFlightByRider((prev) => {
          const next = { ...prev };
          delete next[rider.id];
          return next;
        });
      }
      setActingKey(null);
      setMode(null);
      setReason("");
    } catch (err) {
      setActionError(err instanceof ApiClientError ? err.message : "That action didn't go through.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold text-ink">Riders</h1>
        <p className="text-sm text-muted">
          Suspending a rider blocks new job offers immediately and takes them off duty; anything already in flight
          is left for you to handle deliberately, not auto-cancelled (US-A-06).
        </p>
      </div>

      {loadError && <p className="text-sm text-danger">{loadError}</p>}
      {actionError && <p className="text-sm text-danger">{actionError}</p>}

      {riders === null && !loadError ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : (
        <div className="flex flex-col gap-3">
          {riders?.map((rider) => {
            const inFlight = inFlightByRider[rider.id];
            return (
            <Card key={rider.id} className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-lg font-semibold text-ink">{rider.fullName}</p>
                  <p className="text-sm text-muted">
                    {rider.vehicleType} · {rider.onDuty ? "On duty" : "Off duty"} · since {new Date(rider.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${statusStyle[rider.status]}`}>
                  {rider.status}
                </span>
              </div>

              {inFlight && (
                <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm">
                  <p className="font-medium text-ink">
                    {inFlight.length === 0
                      ? "No orders were in flight."
                      : `${inFlight.length} order(s) still in flight — handle these deliberately:`}
                  </p>
                  <div className="mt-1 flex flex-col gap-1">
                    {inFlight.map((o) => (
                      <Link key={o.id} href={`/orders/${o.id}`} className="text-primary underline">
                        {o.id.slice(0, 8)} · {o.status}
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {actingKey === rider.id ? (
                <div className="flex flex-col gap-2 border-t border-gray-200 pt-3">
                  <Input
                    label={`Reason for ${mode} (written to the audit log, sent to the rider)`}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    required
                  />
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="danger"
                      disabled={isSubmitting || !reason.trim()}
                      onClick={() => handleConfirm(rider)}
                    >
                      {isSubmitting ? "Working…" : `Confirm ${mode}`}
                    </Button>
                    <Button type="button" variant="secondary" onClick={() => setActingKey(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                rider.status === "approved" ? (
                  <Button type="button" variant="danger" onClick={() => openAction(rider.id, "suspend")}>
                    Suspend
                  </Button>
                ) : rider.status === "suspended" ? (
                  <Button type="button" onClick={() => openAction(rider.id, "unsuspend")}>
                    Unsuspend
                  </Button>
                ) : null
              )}
            </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
