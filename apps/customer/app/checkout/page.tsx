"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, PhoneInput, useAuthSession } from "@closebuy/ui";
import { ApiClientError } from "@closebuy/api-client";
import { formatNaira, minor } from "@closebuy/types";
import type { CheckoutInput } from "@closebuy/types";
import type { GeocodeResultDto, AddressDto } from "@closebuy/types";
import { catalogApi, customerAuthApi, geocodeApi, orderApi } from "@/lib/api";
import { useCart, type CartSyncChange } from "@/lib/cart";
import { addGuestOrder } from "@/lib/guestOrders";
import { DeliveryLocationMap } from "@/components/DeliveryLocationMap";
import { AddressSearch } from "@/components/AddressSearch";

type PaymentChoice = "online" | "cash_on_delivery";

/**
 * screens-navigation.md §1.6. Address is a real pin — browser geolocation,
 * an address search (AddressSearch, backed by geocode/service.ts's
 * Nominatim proxy), the map (fine-tune by dragging), or typed coordinates
 * — plus a required landmark, never a bare postal string (brief §3.4:
 * street addressing is unreliable across much of the launch market, so a
 * text address alone must never be assumed accurate). The search box makes
 * *setting* that pin feel like typing an address instead of hunting for
 * coordinates; it doesn't change what's actually being validated — every
 * path here still ends at a lat/lng, and server-side service-area
 * validation (US-C-05) still runs against that pin regardless of which
 * path set it, rejecting an outside-Riverpark one with a clear reason,
 * never silently accepting it. DeliveryLocationMap renders nothing if
 * NEXT_PUBLIC_GOOGLE_MAPS_API_KEY isn't set in a given environment (it
 * currently isn't, live — Known issues in CLAUDE.md) — geolocation,
 * search, and manual entry are all real without it, this is additive.
 */
export default function CheckoutPage() {
  const router = useRouter();
  const { session, isLoaded: sessionLoaded } = useAuthSession();
  const { cart, isLoaded: cartLoaded, subtotalMinor, clearCart, syncWithLiveProducts } = useCart();

  // Reused across a network-level retry (so a double-tap can't place two orders), but replaced once the
  // server has answered with an error: that order wasn't placed, and replaying the key would just hand back
  // the same failed attempt.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [deliveryFeeMinor, setDeliveryFeeMinor] = useState<number | null>(null);

  const [contactPhone, setContactPhone] = useState("");
  const [alternateContactPhone, setAlternateContactPhone] = useState("");
  const [saveAsDefault, setSaveAsDefault] = useState(false);
  const [email, setEmail] = useState("");

  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [accuracyMeters, setAccuracyMeters] = useState<number | null>(null);
  // Set by picking an AddressSearch result, or by a best-effort reverse-geocode after "Use my current
  // location" succeeds. Cleared by anything that changes the pin WITHOUT a known label for the new spot
  // (dragging the map, typing coordinates by hand) — showing a stale label next to a pin it no longer
  // describes would be worse than just falling back to the coordinates, which is what happens when this is null.
  const [addressLabel, setAddressLabel] = useState<string | null>(null);
  const [landmark, setLandmark] = useState("");
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  // US-C-05 — a saved address is a shortcut into the same pin/landmark
  // fields below, never a separate code path: picking one just prefills
  // them, and selectedAddressId is cleared the moment anything about the
  // pin changes afterward, so a stale "this is Home" tag can never survive
  // onto a delivery that's since moved somewhere else.
  const [savedAddresses, setSavedAddresses] = useState<AddressDto[] | null>(null);
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  const [saveThisAddress, setSaveThisAddress] = useState(false);
  const [newAddressLabel, setNewAddressLabel] = useState("");
  // A desktop/laptop has no GPS chip — the browser falls back to WiFi/IP
  // positioning, which can be off by hundreds of metres to several
  // kilometres and can return a different fix each time (which WiFi
  // networks are visible right now). Riverpark's real boundary is only
  // ~700m across, smaller than that error margin, so "I'm standing in the
  // same spot and it says I'm not in Riverpark" is a real, expected
  // consequence of testing from a desktop, not a bug in the polygon check
  // (lib/geo.ts) or the seeded boundary (prisma/seed.ts) — both are
  // correct. Surfacing accuracy, rather than silently trusting whatever fix
  // came back, is what makes that legible instead of a black box.
  const POOR_ACCURACY_METERS = 300;
  const [showManualHint, setShowManualHint] = useState(false);

  const [paymentChoice, setPaymentChoice] = useState<PaymentChoice>("online");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isDelivery = cart.fulfilmentType === "delivery";

  // A failed submit must be *seen* — on a phone the message can sit below the fold of a long form.
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [error]);

  // Guards against landing on this page with nothing in the cart (a stale bookmark, the back button after
  // checkout, a manually-typed URL) — NOT against a cart that's empty *because checkout just succeeded and
  // cleared it*. Without orderJustPlacedRef, clearCart() below re-triggers this same effect (cart.items.length
  // now 0) and its router.replace("/cart") would race the redirect to the tracking page and usually win,
  // since it fires from a commit this page's own re-render causes, right as the intended navigation is still
  // in flight. Confirmed live: a real guest checkout landed on /cart, not the order it had just placed.
  const orderJustPlacedRef = useRef(false);
  useEffect(() => {
    if (!cartLoaded || orderJustPlacedRef.current) return;
    if (!cart.vendor || cart.items.length === 0) router.replace("/cart");
  }, [cartLoaded, cart.vendor, cart.items.length, router]);

  // US-C-04 — "re-validated for price and stock at checkout, and any
  // change is shown before payment." Runs once against the vendor's live
  // catalogue; syncWithLiveProducts both corrects the cart in place (so the
  // subtotal/total below is never wrong) and reports what changed, so it's
  // shown rather than silently applied. The actual charge is still
  // re-validated server-side regardless (order/service.ts) — this is the
  // "shown" half specifically.
  const [catalogChanges, setCatalogChanges] = useState<CartSyncChange[] | null>(null);
  const syncedRef = useRef(false);
  useEffect(() => {
    if (!cartLoaded || syncedRef.current || !cart.vendor || cart.items.length === 0) return;
    syncedRef.current = true;
    catalogApi
      .getVendorProducts(cart.vendor.id)
      .then((res) => setCatalogChanges(syncWithLiveProducts(res.products)))
      .catch(() => {}); // best-effort — the server-side check at submit is still the real safety net
  }, [cartLoaded, cart.vendor, cart.items.length, syncWithLiveProducts]);

  useEffect(() => {
    if (isDelivery) {
      catalogApi.getDeliveryFee().then((res) => setDeliveryFeeMinor(res.feeMinor)).catch(() => {});
    }
  }, [isDelivery]);

  useEffect(() => {
    if (!session) return;
    customerAuthApi
      .getProfile()
      .then((res) => {
        if (res.profile.defaultPhone) setContactPhone(res.profile.defaultPhone);
      })
      .catch(() => {});
  }, [session]);

  useEffect(() => {
    if (!session || !isDelivery) return;
    customerAuthApi
      .listAddresses()
      .then((res) => setSavedAddresses(res.addresses))
      .catch(() => {}); // best-effort — checkout still works fully without this
  }, [session, isDelivery]);

  function selectSavedAddress(address: AddressDto) {
    setLat(address.lat);
    setLng(address.lng);
    setLandmark(address.landmarkDescription);
    setContactPhone(address.contactPhone);
    setAddressLabel(address.label);
    setAccuracyMeters(null);
    setLocationError(null);
    setShowManualHint(false);
    setSelectedAddressId(address.id);
  }

  function useCurrentLocation() {
    setLocationError(null);
    setAddressLabel(null);
    setSelectedAddressId(null);
    if (!navigator.geolocation) {
      setLocationError("Your browser doesn't support location — enter coordinates manually below.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        setLat(latitude);
        setLng(longitude);
        setAccuracyMeters(accuracy);
        setShowManualHint(accuracy > POOR_ACCURACY_METERS);
        setLocating(false);
        // Best-effort — a raw coordinate is still shown (below) if this fails or is slow; never blocks anything.
        geocodeApi
          .reverse(latitude, longitude)
          .then((res) => setAddressLabel(res.label))
          .catch(() => {});
      },
      () => {
        setLocationError("Couldn't get your location — check permissions, or enter coordinates manually below.");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  function handleAddressSelected(result: GeocodeResultDto) {
    setLat(result.lat);
    setLng(result.lng);
    setAddressLabel(result.label);
    setAccuracyMeters(null); // a geocoded match has no GPS-style accuracy figure — nothing to warn about
    setLocationError(null);
    setShowManualHint(false);
    setSelectedAddressId(null);
  }

  if (!sessionLoaded || !cartLoaded || !cart.vendor || cart.items.length === 0) return null;

  const totalMinor = subtotalMinor + (isDelivery ? (deliveryFeeMinor ?? 0) : 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (isDelivery && (lat === null || lng === null)) {
      setError("Add your delivery location first.");
      return;
    }
    if (isDelivery && landmark.trim().length < 3) {
      setError("Describe a nearby landmark so a rider can find you.");
      return;
    }
    if (!contactPhone.trim()) {
      setError("A contact number is required.");
      return;
    }

    setIsSubmitting(true);
    try {
      const input: CheckoutInput = {
        vendorId: cart.vendor!.id,
        items: cart.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
        fulfilmentType: cart.fulfilmentType,
        scheduledFor: cart.scheduledFor ?? undefined,
        deliveryLat: isDelivery ? lat! : undefined,
        deliveryLng: isDelivery ? lng! : undefined,
        deliveryLandmark: isDelivery ? landmark.trim() : undefined,
        addressId: isDelivery ? (selectedAddressId ?? undefined) : undefined,
        paymentMethod: paymentChoice === "cash_on_delivery" ? "cash_on_delivery" : "card",
        contactPhone,
        alternateContactPhone: alternateContactPhone || undefined,
        email: !session && paymentChoice === "online" ? email.trim() || undefined : undefined,
      };

      const result = await orderApi.checkout(input, idempotencyKey);
      orderJustPlacedRef.current = true; // before clearCart() below empties it and would otherwise bounce us to /cart

      if (session && saveAsDefault) {
        // Best-effort — never blocks a successful order on a profile-save failing.
        customerAuthApi.updateProfile({ defaultPhone: contactPhone }).catch(() => {});
      }
      if (session && isDelivery && saveThisAddress && newAddressLabel.trim() && lat !== null && lng !== null) {
        // Also best-effort, same reasoning — the order is already placed regardless of whether this succeeds.
        customerAuthApi
          .createAddress({ label: newAddressLabel.trim(), lat, lng, landmarkDescription: landmark.trim(), contactPhone })
          .catch(() => {});
      }
      if (!session) addGuestOrder(result.trackingToken); // so it shows up under Orders on this device — see lib/guestOrders.ts

      clearCart();

      if (result.checkoutUrl) {
        window.location.href = result.checkoutUrl; // Monnify's hosted payment page
      } else {
        router.push(`/orders/track/${result.trackingToken}`);
      }
    } catch (err) {
      if (err instanceof ApiClientError) setIdempotencyKey(crypto.randomUUID());
      if (err instanceof ApiClientError && err.code === "OUTSIDE_SERVICE_AREA") {
        // The pin the server actually checked, not a vague "somewhere wrong" —
        // most often this is desktop WiFi/IP geolocation drift (see the note by
        // POOR_ACCURACY_METERS above), not a mistyped pin, so show it plainly
        // rather than just repeating the API's own "we don't deliver there".
        setError(
          `${err.message} The location submitted was ${lat?.toFixed(5)}, ${lng?.toFixed(5)}` +
            (accuracyMeters ? ` (accurate to about ±${Math.round(accuracyMeters)}m)` : "") +
            ". If that's not where you are, search your street above again, or enter exact coordinates below — look up your address on Google Maps, right-click the pin, and the coordinates are the first line of the menu that appears.",
        );
        setShowManualHint(true);
      } else {
        setError(err instanceof ApiClientError ? err.message : "Couldn't reach CloseBuy. Check your connection and try again.");
      }
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5 p-4 pb-8">
      <h1 className="text-lg font-bold text-ink">Checkout</h1>

      {catalogChanges && catalogChanges.length > 0 && (
        <section className="flex flex-col gap-1 rounded-lg bg-warning/10 p-3 text-sm text-ink" role="status">
          <p className="font-medium">Your cart changed since you added these:</p>
          <ul className="list-disc pl-4 text-xs text-muted">
            {catalogChanges.map((c) => (
              <li key={c.productId}>
                {c.kind === "removed" && `${c.name} is no longer available and was removed.`}
                {c.kind === "reduced" && `${c.name}: only ${c.newQuantity} left, quantity updated from ${c.oldQuantity}.`}
                {c.kind === "price_changed" &&
                  `${c.name}: price updated from ${formatNaira(minor(c.oldPriceMinor!))} to ${formatNaira(minor(c.newPriceMinor!))}.`}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">The totals below already reflect this.</p>
        </section>
      )}

      {isDelivery ? (
        <section className="flex flex-col gap-2">
          <p className="text-sm font-medium text-ink">Delivery location</p>

          {savedAddresses && savedAddresses.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {savedAddresses.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => selectSavedAddress(a)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                    selectedAddressId === a.id ? "border-primary bg-primary/10 text-primary" : "border-gray-300 text-ink"
                  }`}
                >
                  {a.label}
                </button>
              ))}
            </div>
          )}

          <AddressSearch onSelect={handleAddressSelected} />

          <div className="flex items-center gap-2 text-xs text-muted">
            <span className="h-px flex-1 bg-gray-200" />
            or
            <span className="h-px flex-1 bg-gray-200" />
          </div>
          <Button type="button" variant="secondary" onClick={useCurrentLocation} disabled={locating}>
            {locating ? "Locating…" : lat !== null ? "Location set — tap to refresh" : "Use my current location"}
          </Button>
          {locationError && <p className="text-xs text-danger">{locationError}</p>}

          {/* The whole point of AddressSearch/reverse-geocoding: a real street/area name here instead of raw
              numbers. The coordinates only surface when no label could be resolved for the current pin — never
              hidden outright, since at that point they're the only description of where the pin actually is. */}
          {addressLabel ? (
            <p className="text-sm text-ink">{addressLabel}</p>
          ) : (
            lat !== null &&
            lng !== null && (
              <p className={`text-xs ${accuracyMeters && accuracyMeters > POOR_ACCURACY_METERS ? "text-danger" : "text-muted"}`}>
                {lat.toFixed(5)}, {lng.toFixed(5)}
                {accuracyMeters !== null && ` — accurate to about ±${Math.round(accuracyMeters)}m`}
              </p>
            )
          )}
          {accuracyMeters !== null && accuracyMeters > POOR_ACCURACY_METERS && (
            <p className="text-xs text-danger">
              That&apos;s not precise — normal for a laptop with no GPS (it falls back to WiFi/IP location, which can
              land hundreds of metres away and change between tries). Search your street above instead, or enter
              exact coordinates below.
            </p>
          )}
          <DeliveryLocationMap
            lat={lat}
            lng={lng}
            onChange={(newLat, newLng) => {
              setLat(newLat);
              setLng(newLng);
              setAccuracyMeters(null);
              setAddressLabel(null);
              setSelectedAddressId(null);
            }}
          />
          {lat !== null && lng !== null && (
            <p className="text-xs text-muted">Drag the pin or tap the map to fine-tune the exact spot.</p>
          )}
          <details className="text-xs text-muted" open={showManualHint} onToggle={(e) => setShowManualHint(e.currentTarget.open)}>
            <summary className="cursor-pointer select-none">Enter coordinates manually instead</summary>
            <p className="mt-1.5">
              On Google Maps: right-click your exact spot → the coordinates are the first line of the menu that
              appears → tap to copy.
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Input
                placeholder="Latitude"
                inputMode="decimal"
                value={lat ?? ""}
                onChange={(e) => {
                  setLat(e.target.value ? Number(e.target.value) : null);
                  setAccuracyMeters(null);
                  setAddressLabel(null);
                  setSelectedAddressId(null);
                }}
              />
              <Input
                placeholder="Longitude"
                inputMode="decimal"
                value={lng ?? ""}
                onChange={(e) => {
                  setLng(e.target.value ? Number(e.target.value) : null);
                  setAccuracyMeters(null);
                  setAddressLabel(null);
                  setSelectedAddressId(null);
                }}
              />
            </div>
          </details>
          <Input
            label="Landmark"
            placeholder="e.g. Blue gate beside Corner Shop"
            value={landmark}
            onChange={(e) => setLandmark(e.target.value)}
            required
          />

          {session && !selectedAddressId && (
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-xs text-muted">
                <input type="checkbox" checked={saveThisAddress} onChange={(e) => setSaveThisAddress(e.target.checked)} />
                Save this address for next time
              </label>
              {saveThisAddress && (
                <Input placeholder='Name it, e.g. "Home"' value={newAddressLabel} onChange={(e) => setNewAddressLabel(e.target.value)} />
              )}
            </div>
          )}
        </section>
      ) : (
        <section className="rounded-lg bg-surface p-3 text-sm text-ink">
          Pickup from <span className="font-medium">{cart.vendor.businessName}</span>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <p className="text-sm font-medium text-ink">Contact</p>
        <PhoneInput label="Phone number" value={contactPhone} onChange={setContactPhone} required />
        <PhoneInput label="Alternate number (optional)" value={alternateContactPhone} onChange={setAlternateContactPhone} />
        {session && (
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={saveAsDefault} onChange={(e) => setSaveAsDefault(e.target.checked)} />
            Save as my default number
          </label>
        )}
        {!session && paymentChoice === "online" && (
          <Input
            label="Email (optional — for your payment receipt)"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        )}
      </section>

      <section className="flex flex-col gap-2">
        <p className="text-sm font-medium text-ink">Payment</p>
        <PaymentOption
          label="Pay online now (card or bank transfer)"
          selected={paymentChoice === "online"}
          onSelect={() => setPaymentChoice("online")}
        />
        {isDelivery && (
          <PaymentOption
            label="Cash on delivery"
            selected={paymentChoice === "cash_on_delivery"}
            onSelect={() => setPaymentChoice("cash_on_delivery")}
          />
        )}
      </section>

      <section className="flex flex-col gap-1 border-t border-gray-200 pt-3 text-sm">
        <div className="flex justify-between">
          <span className="text-muted">Subtotal</span>
          <span className="text-ink">{formatNaira(minor(subtotalMinor))}</span>
        </div>
        {isDelivery && (
          <div className="flex justify-between">
            <span className="text-muted">Delivery fee</span>
            <span className="text-ink">{deliveryFeeMinor === null ? "…" : formatNaira(minor(deliveryFeeMinor))}</span>
          </div>
        )}
        <div className="flex justify-between font-semibold">
          <span className="text-ink">Total</span>
          <span className="text-ink">{formatNaira(minor(totalMinor))}</span>
        </div>
      </section>

      <p className="text-xs text-muted">
        {cart.scheduledFor
          ? `${isDelivery ? "Delivery" : "Pickup"} scheduled for ${new Date(cart.scheduledFor).toLocaleString()}`
          : `${isDelivery ? "Delivery" : "Pickup"} as soon as possible`}
      </p>

      {error && (
        <p ref={errorRef} role="alert" className="rounded-lg bg-danger/10 p-3 text-sm font-medium text-danger">
          {error}
        </p>
      )}

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Placing order…" : `Place order · ${formatNaira(minor(totalMinor))}`}
      </Button>
    </form>
  );
}

function PaymentOption({ label, selected, onSelect }: { label: string; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex items-center justify-between rounded-lg border px-4 py-3 text-left text-sm transition ${
        selected ? "border-primary bg-primary/5" : "border-gray-200"
      }`}
    >
      {label}
      <span className={`h-4 w-4 shrink-0 rounded-full border-2 ${selected ? "border-primary bg-primary" : "border-gray-300"}`} />
    </button>
  );
}
