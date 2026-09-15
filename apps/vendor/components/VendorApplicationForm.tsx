"use client";

import { useEffect, useState } from "react";
import { Button, Input } from "@closebuy/ui";
import { ApiClientError } from "@closebuy/api-client";
import type { CategoryDto } from "@closebuy/types";
import { catalogApi } from "@/lib/api";

/**
 * US-V-01. Pickup location is a real pin (browser geolocation) + landmark
 * — never a postal string (brief §3.4), same pattern as the customer
 * app's checkout screen. No document upload — R2 isn't configured
 * (ADR-0001), so `idDocumentUrl`-style fields aren't part of this form at
 * all; VendorApplicationInput doesn't have one to begin with.
 */
export function VendorApplicationForm({ onSubmitted }: { onSubmitted: () => void }) {
  const [categories, setCategories] = useState<CategoryDto[]>([]);
  const [businessName, setBusinessName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [description, setDescription] = useState("");
  const [pickupPhone, setPickupPhone] = useState("");
  const [bankAccountRef, setBankAccountRef] = useState("");

  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [landmark, setLandmark] = useState("");
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    catalogApi.listCategories().then((res) => {
      setCategories(res.categories);
      if (res.categories[0]) setCategoryId(res.categories[0].id);
    }).catch(() => {});
  }, []);

  function useCurrentLocation() {
    setLocationError(null);
    if (!navigator.geolocation) {
      setLocationError("Your browser doesn't support location — enter coordinates manually below.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude);
        setLng(pos.coords.longitude);
        setLocating(false);
      },
      () => {
        setLocationError("Couldn't get your location — check permissions, or enter coordinates manually below.");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (lat === null || lng === null) {
      setError("Add your pickup location first.");
      return;
    }
    if (landmark.trim().length < 3) {
      setError("Describe a nearby landmark so customers and riders can find you.");
      return;
    }

    setIsSubmitting(true);
    try {
      await catalogApi.applyAsVendor({
        businessName: businessName.trim(),
        categoryId,
        description: description.trim() || undefined,
        pickupLat: lat,
        pickupLng: lng,
        pickupLandmark: landmark.trim(),
        pickupPhone: pickupPhone.trim(),
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
        <h1 className="text-xl font-bold text-ink">Become a CloseBuy vendor</h1>
        <p className="mt-1 text-sm text-muted">
          Riverpark only for now (brief §2a). Applications are reviewed by an operator — approval is manual, US-A-01.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input label="Business name" value={businessName} onChange={(e) => setBusinessName(e.target.value)} required />

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-ink">Category</label>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            required
            className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <Input
          label="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What do you sell?"
        />

        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-ink">Pickup location</p>
          <Button type="button" variant="secondary" onClick={useCurrentLocation} disabled={locating}>
            {locating ? "Locating…" : lat !== null ? "Location set — tap to refresh" : "Use my current location"}
          </Button>
          {locationError && <p className="text-xs text-danger">{locationError}</p>}
          {lat !== null && lng !== null && (
            <p className="text-xs text-muted">
              {lat.toFixed(5)}, {lng.toFixed(5)}
            </p>
          )}
          <details className="text-xs text-muted">
            <summary className="cursor-pointer select-none">Enter coordinates manually instead</summary>
            <div className="mt-2 flex gap-2">
              <Input
                placeholder="Latitude"
                inputMode="decimal"
                value={lat ?? ""}
                onChange={(e) => setLat(e.target.value ? Number(e.target.value) : null)}
              />
              <Input
                placeholder="Longitude"
                inputMode="decimal"
                value={lng ?? ""}
                onChange={(e) => setLng(e.target.value ? Number(e.target.value) : null)}
              />
            </div>
          </details>
          <Input
            label="Landmark"
            placeholder="e.g. Blue gate opposite the market"
            value={landmark}
            onChange={(e) => setLandmark(e.target.value)}
            required
          />
        </div>

        <Input
          label="Pickup contact phone"
          type="tel"
          value={pickupPhone}
          onChange={(e) => setPickupPhone(e.target.value)}
          placeholder="+2348012345678"
          required
        />
        <Input
          label="Bank account reference (optional)"
          value={bankAccountRef}
          onChange={(e) => setBankAccountRef(e.target.value)}
          placeholder="Used for payouts once you're approved"
        />

        {error && <p className="text-sm text-danger">{error}</p>}

        <Button type="submit" disabled={isSubmitting || !categoryId}>
          {isSubmitting ? "Submitting…" : "Submit application"}
        </Button>
      </form>
    </div>
  );
}
