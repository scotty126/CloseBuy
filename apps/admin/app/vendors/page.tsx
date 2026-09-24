"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Card, Input, useAuthSession } from "@closebuy/ui";
import { ApiClientError } from "@closebuy/api-client";
import type { AdminVendorDto, AdminOrderSummaryDto, VendorStatus } from "@closebuy/types";
import { adminApi } from "@/lib/api";

const statusStyle: Record<VendorStatus, string> = {
  pending: "bg-muted/10 text-muted",
  approved: "bg-success/10 text-success",
  suspended: "bg-danger/10 text-danger",
  rejected: "bg-danger/10 text-danger",
};

/** No dedicated screens-navigation.md entry yet — the vendor side of US-A-06 (suspend an actor). Applications (§4.1) stays pending-only; this is every vendor, any status. */
export default function VendorsPage() {
  const router = useRouter();
  const { session, isLoaded } = useAuthSession();

  const [vendors, setVendors] = useState<AdminVendorDto[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actingKey, setActingKey] = useState<string | null>(null); // reason form open for this vendor id
  const [mode, setMode] = useState<"suspend" | "unsuspend" | null>(null);
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [inFlightByVendor, setInFlightByVendor] = useState<Record<string, AdminOrderSummaryDto[]>>({});

  useEffect(() => {
    if (isLoaded && !session) router.push("/login");
  }, [isLoaded, session, router]);

  useEffect(() => {
    if (!session) return;
    adminApi
      .listVendors()
      .then((res) => setVendors(res.vendors))
      .catch((err) => setLoadError(err instanceof ApiClientError ? err.message : "Couldn't load vendors."));
  }, [session]);

  if (!isLoaded || !session) return null;

  function openAction(vendorId: string, actionMode: "suspend" | "unsuspend") {
    setActingKey(vendorId);
    setMode(actionMode);
    setReason("");
    setActionError(null);
  }

  async function handleConfirm(vendor: AdminVendorDto) {
    if (!reason.trim() || !mode) return;
    setIsSubmitting(true);
    setActionError(null);
    try {
      if (mode === "suspend") {
        const res = await adminApi.suspendVendor(vendor.id, { reason: reason.trim() });
        setVendors((prev) => prev?.map((v) => (v.id === vendor.id ? res.vendor : v)) ?? prev);
        setInFlightByVendor((prev) => ({ ...prev, [vendor.id]: res.inFlightOrders }));
      } else {
        const res = await adminApi.unsuspendVendor(vendor.id, { reason: reason.trim() });
        setVendors((prev) => prev?.map((v) => (v.id === vendor.id ? res.vendor : v)) ?? prev);
        setInFlightByVendor((prev) => {
          const next = { ...prev };
          delete next[vendor.id];
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
        <h1 className="text-xl font-bold text-ink">Vendors</h1>
        <p className="text-sm text-muted">
          Suspending a vendor blocks new orders immediately; anything already in flight is left for you to handle
          deliberately, not auto-cancelled (US-A-06).
        </p>
      </div>

      {loadError && <p className="text-sm text-danger">{loadError}</p>}
      {actionError && <p className="text-sm text-danger">{actionError}</p>}

      {vendors === null && !loadError ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : (
        <div className="flex flex-col gap-3">
          {vendors?.map((vendor) => {
            const inFlight = inFlightByVendor[vendor.id];
            return (
            <Card key={vendor.id} className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-lg font-semibold text-ink">{vendor.businessName}</p>
                  <p className="text-sm text-muted">
                    {vendor.category.name} · {vendor.isOpen ? "Open" : "Closed"} · since {new Date(vendor.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${statusStyle[vendor.status]}`}>
                  {vendor.status}
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

              {actingKey === vendor.id ? (
                <div className="flex flex-col gap-2 border-t border-gray-200 pt-3">
                  <Input
                    label={`Reason for ${mode} (written to the audit log, sent to the vendor)`}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    required
                  />
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="danger"
                      disabled={isSubmitting || !reason.trim()}
                      onClick={() => handleConfirm(vendor)}
                    >
                      {isSubmitting ? "Working…" : `Confirm ${mode}`}
                    </Button>
                    <Button type="button" variant="secondary" onClick={() => setActingKey(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                vendor.status === "approved" ? (
                  <Button type="button" variant="danger" onClick={() => openAction(vendor.id, "suspend")}>
                    Suspend
                  </Button>
                ) : vendor.status === "suspended" ? (
                  <Button type="button" onClick={() => openAction(vendor.id, "unsuspend")}>
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
