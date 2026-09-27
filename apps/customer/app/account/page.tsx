"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button, Card, Input, Placeholder, PhoneInput, useAuthSession } from "@closebuy/ui";
import { ApiClientError } from "@closebuy/api-client";
import type { AddressDto, GeocodeResultDto } from "@closebuy/types";
import { customerAuthApi } from "@/lib/api";
import { AddressSearch } from "@/components/AddressSearch";

/**
 * screens-navigation.md §1.9. Real for what has backend support: profile
 * (email, default contact phone), saved addresses (US-C-05, addresses.ts —
 * the `addresses` table and Order.addressId existed since the very first
 * migration, but nothing ever exposed CRUD for it until now) and the
 * orders shortcut. Payment methods and ratings-given still aren't built —
 * there's no ratings-read endpoint to show real data against, so that half
 * stays a Placeholder rather than a fake list.
 */
export default function AccountPage() {
  const router = useRouter();
  const { session, isLoaded, clear } = useAuthSession();

  const [defaultPhone, setDefaultPhone] = useState("");
  const [savedPhone, setSavedPhone] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!session) return;
    customerAuthApi
      .getProfile()
      .then((res) => {
        setDefaultPhone(res.profile.defaultPhone ?? "");
        setSavedPhone(res.profile.defaultPhone);
      })
      .catch(() => {});
  }, [session]);

  if (!isLoaded) return null;

  // A guest reaches order status via their tracking link (US-C-06a), not
  // through here — this screen is specifically for a signed-in account.
  if (!session) {
    return (
      <div className="flex flex-col items-center gap-4 p-4 text-center">
        <Placeholder
          title="No account yet"
          note="Sign in for order history, saved addresses and editable ratings — none of it required just to order."
        />
        <Button onClick={() => router.push("/login")}>Sign in</Button>
        <p className="text-xs text-muted">
          <Link href="/terms" className="underline">Terms of Service</Link> ·{" "}
          <Link href="/privacy" className="underline">Privacy Policy</Link>
        </p>
      </div>
    );
  }

  async function handleSavePhone() {
    setSaveError(null);
    setSaved(false);
    setIsSaving(true);
    try {
      const res = await customerAuthApi.updateProfile({ defaultPhone: defaultPhone || null });
      setSavedPhone(res.profile.defaultPhone);
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof ApiClientError ? err.message : "Couldn't save.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <Card>
        <p className="text-sm text-muted">Signed in as</p>
        <p className="text-lg font-semibold text-ink">{session.user.email}</p>
      </Card>

      <Link href="/orders" className="flex items-center justify-between rounded-xl border border-gray-200 bg-white p-4">
        <span className="text-sm font-medium text-ink">Order history</span>
        <span className="text-muted">›</span>
      </Link>

      <div className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-4">
        <p className="text-sm font-medium text-ink">Default contact number</p>
        <p className="text-xs text-muted">Presets the phone field at checkout — never verified, never used to sign in (brief §3.1b).</p>
        <PhoneInput
          value={defaultPhone}
          onChange={(v) => {
            setDefaultPhone(v);
            setSaved(false);
          }}
        />
        {saveError && <p className="text-xs text-danger">{saveError}</p>}
        <Button
          variant="secondary"
          onClick={handleSavePhone}
          disabled={isSaving || defaultPhone === (savedPhone ?? "")}
        >
          {isSaving ? "Saving…" : saved ? "Saved" : "Save"}
        </Button>
      </div>

      <AddressManager />

      <Placeholder title="Ratings you've given" note="US-C-10 — no ratings-read endpoint yet to list them back. Real future scope, not a silent gap." />

      <Button
        variant="secondary"
        onClick={() => {
          clear();
          router.push("/");
        }}
      >
        Sign out
      </Button>

      <p className="text-center text-xs text-muted">
        <Link href="/terms" className="underline">Terms of Service</Link> ·{" "}
        <Link href="/privacy" className="underline">Privacy Policy</Link>
      </p>
    </div>
  );
}

/**
 * US-C-05. Never authoritative for an order — checkout copies its own
 * delivery pin at the moment of placing it (data-model.md
 * §"Address"); this is reuse/rename/delete convenience only, and checkout
 * offers picking one of these as a shortcut rather than requiring it.
 */
function AddressManager() {
  const [addresses, setAddresses] = useState<AddressDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formOpenFor, setFormOpenFor] = useState<"new" | string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    customerAuthApi
      .listAddresses()
      .then((res) => setAddresses(res.addresses))
      .catch((err) => {
        setError(err instanceof ApiClientError ? err.message : "Couldn't load your addresses.");
        setAddresses([]); // stop showing "Loading…" forever alongside the error
      });
  }, []);

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await customerAuthApi.deleteAddress(id);
      setAddresses((list) => list?.filter((a) => a.id !== id) ?? list);
      setConfirmingDeleteId(null);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Couldn't delete that address.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-sm font-medium text-ink">Saved addresses</p>
      {error && <p className="text-xs text-danger">{error}</p>}

      {addresses === null ? (
        <p className="text-xs text-muted">Loading…</p>
      ) : addresses.length === 0 && formOpenFor !== "new" ? (
        <p className="text-xs text-muted">No saved addresses yet — add one to reuse it at checkout.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {addresses.map((address) =>
            formOpenFor === address.id ? (
              <AddressForm
                key={address.id}
                address={address}
                onSaved={(updated) => {
                  setAddresses((list) => list!.map((a) => (a.id === updated.id ? updated : a)));
                  setFormOpenFor(null);
                }}
                onCancel={() => setFormOpenFor(null)}
              />
            ) : (
              <div key={address.id} className="flex items-start justify-between gap-2 rounded-lg border border-gray-100 p-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">{address.label}</p>
                  <p className="truncate text-xs text-muted">{address.landmarkDescription}</p>
                  <p className="text-xs text-muted">{address.contactPhone}</p>
                  {!address.isWithinServiceArea && (
                    <p className="text-xs text-danger">Outside the current service area — can&apos;t be used for delivery right now.</p>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {confirmingDeleteId === address.id ? (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleDelete(address.id)}
                        disabled={deletingId === address.id}
                        className="text-xs font-medium text-danger underline"
                      >
                        {deletingId === address.id ? "Deleting…" : "Confirm delete"}
                      </button>
                      <button type="button" onClick={() => setConfirmingDeleteId(null)} className="text-xs text-muted underline">
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => setFormOpenFor(address.id)} className="text-xs text-primary underline">
                        Edit
                      </button>
                      <button type="button" onClick={() => setConfirmingDeleteId(address.id)} className="text-xs text-muted underline">
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ),
          )}
        </div>
      )}

      {formOpenFor === "new" ? (
        <AddressForm
          onSaved={(created) => {
            setAddresses((list) => [...(list ?? []), created]);
            setFormOpenFor(null);
          }}
          onCancel={() => setFormOpenFor(null)}
        />
      ) : (
        <Button variant="secondary" onClick={() => setFormOpenFor("new")}>
          + Add address
        </Button>
      )}
    </div>
  );
}

function AddressForm({
  address,
  onSaved,
  onCancel,
}: {
  address?: AddressDto;
  onSaved: (address: AddressDto) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(address?.label ?? "");
  const [lat, setLat] = useState<number | null>(address?.lat ?? null);
  const [lng, setLng] = useState<number | null>(address?.lng ?? null);
  const [addressLabel, setAddressLabel] = useState<string | null>(null);
  const [landmark, setLandmark] = useState(address?.landmarkDescription ?? "");
  const [contactPhone, setContactPhone] = useState(address?.contactPhone ?? "");
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  function useCurrentLocation() {
    setError(null);
    setAddressLabel(null);
    if (!navigator.geolocation) {
      setError("Your browser doesn't support location — enter coordinates manually below.");
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
        setError("Couldn't get your location — check permissions, or enter coordinates manually below.");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  function handleAddressSelected(result: GeocodeResultDto) {
    setLat(result.lat);
    setLng(result.lng);
    setAddressLabel(result.label);
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (lat === null || lng === null) {
      setError("Set a location first.");
      return;
    }
    if (landmark.trim().length < 3) {
      setError("Describe a nearby landmark so a rider can find it.");
      return;
    }

    setIsSaving(true);
    try {
      const input = { label: label.trim(), lat, lng, landmarkDescription: landmark.trim(), contactPhone };
      const result = address
        ? await customerAuthApi.updateAddress(address.id, input)
        : await customerAuthApi.createAddress(input);
      onSaved(result.address);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Couldn't save this address.");
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-lg border border-gray-200 p-3">
      <Input label="Name" placeholder="e.g. Home, Office" value={label} onChange={(e) => setLabel(e.target.value)} required />

      <AddressSearch onSelect={handleAddressSelected} />

      <div className="flex items-center gap-2 text-xs text-muted">
        <span className="h-px flex-1 bg-gray-200" />
        or
        <span className="h-px flex-1 bg-gray-200" />
      </div>
      <Button type="button" variant="secondary" onClick={useCurrentLocation} disabled={locating}>
        {locating ? "Locating…" : lat !== null ? "Location set — tap to refresh" : "Use my current location"}
      </Button>

      {addressLabel ? (
        <p className="text-sm text-ink">{addressLabel}</p>
      ) : (
        lat !== null &&
        lng !== null && (
          <p className="text-xs text-muted">
            {lat.toFixed(5)}, {lng.toFixed(5)}
          </p>
        )
      )}

      <details className="text-xs text-muted">
        <summary className="cursor-pointer select-none">Enter coordinates manually instead</summary>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Input
            placeholder="Latitude"
            inputMode="decimal"
            value={lat ?? ""}
            onChange={(e) => {
              setLat(e.target.value ? Number(e.target.value) : null);
              setAddressLabel(null);
            }}
          />
          <Input
            placeholder="Longitude"
            inputMode="decimal"
            value={lng ?? ""}
            onChange={(e) => {
              setLng(e.target.value ? Number(e.target.value) : null);
              setAddressLabel(null);
            }}
          />
        </div>
      </details>

      <Input label="Landmark" placeholder="e.g. Blue gate beside Corner Shop" value={landmark} onChange={(e) => setLandmark(e.target.value)} required />
      <PhoneInput label="Contact phone for this address" value={contactPhone} onChange={setContactPhone} required />

      {error && <p className="text-xs text-danger">{error}</p>}

      <div className="flex gap-2">
        <Button type="submit" disabled={isSaving}>
          {isSaving ? "Saving…" : "Save address"}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
