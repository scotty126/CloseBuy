"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button, Input, Placeholder, PhoneInput, ThemeToggle, useAuthSession, useTheme } from "@closebuy/ui";
import { ApiClientError } from "@closebuy/api-client";
import { Bell, ChevronRight, ClipboardList, FileText, Heart, House, MapPin, Pencil, Star, UserRound } from "lucide-react";
import type { AddressDto, GeocodeResultDto, MyRatingDto } from "@closebuy/types";
import { customerAuthApi, orderApi } from "@/lib/api";
import { AddressSearch } from "@/components/AddressSearch";
import { MonoArrow } from "@/components/MonoArrow";

/**
 * screens-navigation.md §1.9. Real for what has backend support: profile
 * (email, default contact phone), saved addresses (US-C-05, addresses.ts —
 * the `addresses` table and Order.addressId existed since the very first
 * migration, but nothing ever exposed CRUD for it until now), ratings
 * given (US-C-10, order/service.ts's listMyRatings — same story, the
 * table existed, nothing ever read it back) and the orders shortcut.
 * Payment methods aren't built — no real payment-method storage exists
 * (cards are handled entirely by Monnify's hosted page), so that stays a
 * Placeholder rather than a fake list.
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
      <div className="flex flex-col gap-4 px-4 pb-8 pt-[18px]">
        <div className="flex justify-end">
          <ThemeToggle />
        </div>
        <div className="flex flex-col items-center gap-3 rounded-2xl bg-primary p-6 text-center text-[#FFF7F1]">
          <span className="flex h-[58px] w-[58px] items-center justify-center rounded-full bg-accent text-night">
            <UserRound size={28} />
          </span>
          <h1 className="text-lg font-semibold">Guest</h1>
          <p className="max-w-xs text-sm opacity-85">
            Sign in for order history, saved addresses and editable ratings — none of it required just to order.
          </p>
          <button
            type="button"
            onClick={() => router.push("/login")}
            className="mt-1 flex h-11 items-center rounded-xl bg-accent px-6 text-sm font-semibold text-night"
          >
            Sign in / Register
          </button>
        </div>
        <ShopCta />
        <p className="text-center text-xs text-muted">
          <Link href="/terms" className="underline">
            Terms of Service
          </Link>{" "}
          ·{" "}
          <Link href="/privacy" className="underline">
            Privacy Policy
          </Link>
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

  const email = session.user.email ?? "";

  return (
    <div className="flex flex-col gap-4 px-4 pb-8 pt-[18px]">
      <div className="flex items-center gap-3.5 rounded-2xl bg-primary p-4 text-[#FFF7F1]">
        <span className="flex h-[58px] w-[58px] shrink-0 items-center justify-center rounded-full bg-accent text-[22px] font-semibold text-[#10231C]">
          {(email.charAt(0) || "?").toUpperCase()}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-lg font-semibold">{email || "Your account"}</span>
          <span className="truncate text-[13px] opacity-85">
            {savedPhone ? `${savedPhone} · ` : ""}Riverpark
          </span>
        </span>
        <a href="#contact" aria-label="Edit contact number" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-[#FFF7F1]/[0.16]">
          <Pencil size={18} strokeWidth={2} aria-hidden="true" />
        </a>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Tile href="/orders" label="Orders" icon={<ClipboardList size={22} strokeWidth={2} className="text-accent" />} />
        <Tile href="/saved" label="Saved" icon={<Heart size={22} strokeWidth={2} className="text-accent" />} />
        <Tile href="#addresses" label="Addresses" icon={<MapPin size={22} strokeWidth={2} className="text-accent" />} />
      </div>

      <div className="rounded-[14px] bg-card px-3.5 py-1">
        <div className="flex min-h-[58px] items-center gap-3">
          <span className="flex flex-1 flex-col gap-px">
            <span className="text-[15px] font-bold text-ink">Dark mode</span>
            <span className="text-xs text-muted">Easier on the eyes at night</span>
          </span>
          <DarkSwitch />
        </div>
      </div>

      <div className="rounded-[14px] bg-card px-3.5 py-1">
        <Link href="/notifications" className="flex min-h-[54px] items-center gap-3 border-b border-line text-ink">
          <Bell size={20} strokeWidth={2} className="text-muted" aria-hidden="true" />
          <span className="flex-1 text-[15px] font-medium">Notifications</span>
          <ChevronRight size={16} strokeWidth={2.2} className="text-muted" aria-hidden="true" />
        </Link>
        <Link href="/terms" className="flex min-h-[54px] items-center gap-3 text-ink">
          <FileText size={20} strokeWidth={2} className="text-muted" aria-hidden="true" />
          <span className="flex-1 text-[15px] font-medium">Terms &amp; privacy</span>
          <ChevronRight size={16} strokeWidth={2.2} className="text-muted" aria-hidden="true" />
        </Link>
      </div>

      <div id="contact" className="flex scroll-mt-4 flex-col gap-2 rounded-[14px] bg-card p-3.5">
        <p className="text-[15px] font-semibold text-ink">Default contact number</p>
        <p className="text-xs text-muted">Presets the phone field at checkout — never verified, never used to sign in.</p>
        <PhoneInput
          value={defaultPhone}
          onChange={(v) => {
            setDefaultPhone(v);
            setSaved(false);
          }}
        />
        {saveError && <p className="text-xs text-danger">{saveError}</p>}
        <Button variant="secondary" onClick={handleSavePhone} disabled={isSaving || defaultPhone === (savedPhone ?? "")}>
          {isSaving ? "Saving…" : saved ? "Saved" : "Save"}
        </Button>
      </div>

      <AddressManager />

      <RatingsGiven />

      <Placeholder title="Payment methods" note="CloseBuy never stores card details — Monnify's hosted page handles those entirely — so there's no real payment method to list here." />

      <ShopCta />

      <button
        type="button"
        onClick={() => {
          clear();
          router.push("/");
        }}
        className="flex h-[50px] items-center justify-center rounded-2xl text-[15px] font-bold text-[#B42318] dark:text-danger"
      >
        Log out
      </button>
    </div>
  );
}

/** The canvas's Dark mode row switch: a 56×44 hit area around a 44×26 track. Writes the same stored choice as every ThemeToggle. */
function DarkSwitch() {
  const { theme, toggle } = useTheme();
  const on = theme === "dark";
  return (
    <button type="button" role="switch" aria-checked={on} aria-label="Dark mode" onClick={toggle} className="flex h-11 w-14 items-center justify-center">
      <span className={`flex h-[26px] w-11 items-center rounded-full p-[3px] transition-colors ${on ? "bg-accent" : "bg-[#D9CBBF]"}`}>
        <span className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-[18px]" : ""}`} />
      </span>
    </button>
  );
}

function Tile({ href, label, icon }: { href: string; label: string; icon: React.ReactNode }) {
  return (
    <Link href={href} className="flex flex-col items-center gap-1.5 rounded-[18px] bg-card px-2.5 py-3.5 text-[13px] font-bold text-ink transition-transform active:scale-95">
      {icon}
      {label}
    </Link>
  );
}

/** The seller-side entry point: the vendor app is a separate site, so this is a plain link out. */
function ShopCta() {
  return (
    <a
      href="https://closebuy-vendor.netlify.app"
      className="relative flex flex-col gap-2 overflow-hidden rounded-[14px] bg-accent p-[18px] text-night"
    >
      <span className="relative text-[19px] font-semibold">Own a shop nearby?</span>
      <span className="relative max-w-[240px] text-sm">Sell on CloseBuy and reach buyers on your street.</span>
      <span className="relative inline-flex items-center gap-1.5 text-sm font-bold">Open seller app <MonoArrow size={13} /></span>
    </a>
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
    <div id="addresses" className="flex scroll-mt-4 flex-col gap-0.5 rounded-[14px] bg-card px-3.5 pb-2.5 pt-1">
      <div className="flex min-h-11 items-center justify-between">
        <p className="text-[15px] font-semibold text-ink">Saved addresses</p>
        {formOpenFor === null && (
          <button type="button" onClick={() => setFormOpenFor("new")} className="py-3 text-[13px] text-ink underline underline-offset-2">
            + Add
          </button>
        )}
      </div>
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
              <div key={address.id} className="flex items-start gap-3 border-t border-line py-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-raised text-ink">
                  <House size={16} strokeWidth={1.8} aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
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

      {formOpenFor === "new" && (
        <AddressForm
          onSaved={(created) => {
            setAddresses((list) => [...(list ?? []), created]);
            setFormOpenFor(null);
          }}
          onCancel={() => setFormOpenFor(null)}
        />
      )}
    </div>
  );
}

/** US-C-10 — read side of the ratings a customer has given, across every order. */
function RatingsGiven() {
  const [ratings, setRatings] = useState<MyRatingDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    orderApi
      .listMyRatings()
      .then((res) => setRatings(res.ratings))
      .catch((err) => setError(err instanceof ApiClientError ? err.message : "Couldn't load your ratings."));
  }, []);

  return (
    <div className="flex flex-col gap-0.5 rounded-[14px] bg-card px-3.5 pb-2.5 pt-1">
      <p className="flex min-h-11 items-center text-[15px] font-semibold text-ink">Ratings you&apos;ve given</p>
      {error ? (
        <p className="text-xs text-danger">{error}</p>
      ) : ratings === null ? (
        <p className="text-xs text-muted">Loading…</p>
      ) : ratings.length === 0 ? (
        <p className="text-xs text-muted">Nothing rated yet — rate an order from its tracking page once it&apos;s complete.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {ratings.map((r) => (
            <Link
              key={r.id}
              href={`/orders/track/${r.trackingToken}`}
              className="flex items-start justify-between gap-2 rounded-lg border border-line p-3 active:bg-surface"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">
                  {r.targetName} <span className="text-xs font-normal text-muted">({r.targetType})</span>
                </p>
                {r.comment && <p className="truncate text-xs text-muted">{r.comment}</p>}
                <p className="text-xs text-muted">{new Date(r.createdAt).toLocaleDateString()}</p>
              </div>
              <div className="flex shrink-0 gap-0.5">
                {[1, 2, 3, 4, 5].map((n) => (
                  <Star key={n} size={14} className={n <= r.score ? "fill-accent text-accent" : "text-muted"} />
                ))}
              </div>
            </Link>
          ))}
        </div>
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
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-lg border border-line p-3">
      <Input label="Name" placeholder="e.g. Home, Office" value={label} onChange={(e) => setLabel(e.target.value)} required />

      <AddressSearch onSelect={handleAddressSelected} />

      <div className="flex items-center gap-2 text-xs text-muted">
        <span className="h-px flex-1 bg-raised" />
        or
        <span className="h-px flex-1 bg-raised" />
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
