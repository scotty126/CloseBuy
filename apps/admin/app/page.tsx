"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Input, useAuthSession } from "@closebuy/ui";
import { ApiClientError } from "@closebuy/api-client";
import type { PendingApplication } from "@closebuy/types";
import { adminApi } from "@/lib/api";

const keyOf = (app: PendingApplication) => `${app.type}:${app.id}`;

export default function ApplicationsPage() {
  const router = useRouter();
  const { session, isLoaded } = useAuthSession();

  const [applications, setApplications] = useState<PendingApplication[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [decidingKey, setDecidingKey] = useState<string | null>(null); // approve/reject in flight
  const [rejectingKey, setRejectingKey] = useState<string | null>(null); // reason form open
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (isLoaded && !session) router.push("/login");
  }, [isLoaded, session, router]);

  useEffect(() => {
    if (!session) return;
    adminApi
      .listApplications()
      .then((res) => setApplications(res.applications))
      .catch((err) => setLoadError(err instanceof ApiClientError ? err.message : "Couldn't load applications."));
  }, [session]);

  if (!isLoaded || !session) return null;

  async function handleApprove(app: PendingApplication) {
    setActionError(null);
    setDecidingKey(keyOf(app));
    try {
      await adminApi.approveApplication(app.type, app.id);
      setApplications((prev) => prev?.filter((a) => keyOf(a) !== keyOf(app)) ?? prev);
    } catch (err) {
      setActionError(err instanceof ApiClientError ? err.message : "Couldn't approve this application.");
    } finally {
      setDecidingKey(null);
    }
  }

  async function handleReject(app: PendingApplication) {
    if (!reason.trim()) return;
    setActionError(null);
    setDecidingKey(keyOf(app));
    try {
      await adminApi.rejectApplication(app.type, app.id, { reason: reason.trim() });
      setApplications((prev) => prev?.filter((a) => keyOf(a) !== keyOf(app)) ?? prev);
      setRejectingKey(null);
      setReason("");
    } catch (err) {
      setActionError(err instanceof ApiClientError ? err.message : "Couldn't reject this application.");
    } finally {
      setDecidingKey(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold text-ink">Vendor & rider applications</h1>
        <p className="text-sm text-muted">
          Approving a vendor while the Founding Vendor Program is open starts their commission-free window
          automatically (US-A-01, brief §3.2a). Rejecting requires a reason — both are written to the audit log.
        </p>
      </div>

      {loadError && <p className="text-sm text-danger">{loadError}</p>}
      {actionError && <p className="text-sm text-danger">{actionError}</p>}

      {applications === null && !loadError ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : applications && applications.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">No pending applications.</p>
        </Card>
      ) : (
        applications?.map((app) => {
          const key = keyOf(app);
          const isDeciding = decidingKey === key;

          return (
            <Card key={key} className="flex flex-col gap-3">
              <div>
                <span className="inline-block rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium uppercase text-primary">
                  {app.type}
                </span>
                <p className="mt-1 text-lg font-semibold text-ink">
                  {app.type === "vendor" ? app.businessName : app.fullName}
                </p>
                <p className="text-sm text-muted">
                  {app.type === "vendor"
                    ? `${app.category.name} · ${app.pickupLandmark} · ${app.pickupPhone}`
                    : `Vehicle: ${app.vehicleType}`}
                </p>
                {app.type === "vendor" && app.description && (
                  <p className="mt-1 text-sm text-ink">{app.description}</p>
                )}
                {app.type === "rider" && app.idDocumentUrl && (
                  <a
                    href={app.idDocumentUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm text-primary underline"
                  >
                    View ID document
                  </a>
                )}
                <p className="mt-1 text-xs text-muted">
                  Applied {new Date(app.createdAt).toLocaleDateString()}
                </p>
              </div>

              {rejectingKey === key ? (
                <div className="flex flex-col gap-2 border-t border-gray-200 pt-3">
                  <Input
                    label="Reason for rejection"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Couldn't verify the business address"
                    required
                  />
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="danger"
                      disabled={isDeciding || !reason.trim()}
                      onClick={() => handleReject(app)}
                    >
                      {isDeciding ? "Rejecting…" : "Confirm rejection"}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        setRejectingKey(null);
                        setReason("");
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2 border-t border-gray-200 pt-3">
                  <Button type="button" disabled={isDeciding} onClick={() => handleApprove(app)}>
                    {isDeciding ? "Approving…" : "Approve"}
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    disabled={isDeciding}
                    onClick={() => {
                      setRejectingKey(key);
                      setReason("");
                    }}
                  >
                    Reject
                  </Button>
                </div>
              )}
            </Card>
          );
        })
      )}
    </div>
  );
}
