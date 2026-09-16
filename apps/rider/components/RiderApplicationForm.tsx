"use client";

import { useState } from "react";
import { Button, Input } from "@closebuy/ui";
import { ApiClientError } from "@closebuy/api-client";
import { dispatchApi } from "@/lib/api";

const VEHICLE_TYPES = ["bicycle", "motorcycle", "car"] as const;

/** US-R-01. No document upload — R2 isn't configured (ADR-0001), so the ID document is a pasted URL, same known gap as Product.images and the vendor application's own pattern. */
export function RiderApplicationForm({ onSubmitted }: { onSubmitted: () => void }) {
  const [fullName, setFullName] = useState("");
  const [vehicleType, setVehicleType] = useState<(typeof VEHICLE_TYPES)[number]>("motorcycle");
  const [idDocumentUrl, setIdDocumentUrl] = useState("");
  const [bankAccountRef, setBankAccountRef] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await dispatchApi.applyAsRider({
        fullName: fullName.trim(),
        vehicleType,
        idDocumentUrl: idDocumentUrl.trim(),
        bankAccountRef: bankAccountRef.trim() || undefined,
      });
      onSubmitted();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Couldn't submit your application. Try again.");
      setIsSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-5 p-6">
      <div>
        <h1 className="text-xl font-bold text-ink">Become a CloseBuy rider</h1>
        <p className="mt-1 text-sm text-muted">Applications are reviewed by an operator — approval is manual, US-A-01.</p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input label="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-ink">Vehicle</label>
          <select
            value={vehicleType}
            onChange={(e) => setVehicleType(e.target.value as (typeof VEHICLE_TYPES)[number])}
            className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
          >
            {VEHICLE_TYPES.map((v) => (
              <option key={v} value={v}>
                {v[0]!.toUpperCase() + v.slice(1)}
              </option>
            ))}
          </select>
        </div>

        <Input
          label="ID document URL"
          value={idDocumentUrl}
          onChange={(e) => setIdDocumentUrl(e.target.value)}
          placeholder="https://…"
          required
        />
        <Input
          label="Bank account reference (optional)"
          value={bankAccountRef}
          onChange={(e) => setBankAccountRef(e.target.value)}
          placeholder="Used for payouts once you're approved"
        />

        {error && <p className="text-sm text-danger">{error}</p>}

        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Submitting…" : "Submit application"}
        </Button>
      </form>
    </div>
  );
}
