"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, PhoneInput, ThemeToggle, useAuthSession } from "@closebuy/ui";
import { ArrowLeft, MapPin, Plus, ShoppingBag, Store } from "lucide-react";
import { ApiClientError } from "@closebuy/api-client";
import { formatNaira, minor } from "@closebuy/types";
import type { CheckoutInput } from "@closebuy/types";
import type { GeocodeResultDto, AddressDto, ProductDto } from "@closebuy/types";
import { catalogApi, customerAuthApi, geocodeApi, orderApi } from "@/lib/api";
import { useCart, type CartSyncChange } from "@/lib/cart";
import { addGuestOrder } from "@/lib/guestOrders";
import { getDeliveryLocation } from "@/lib/deliveryLocation";
import { DeliveryLocationMap } from "@/components/DeliveryLocationMap";
import { AddressSearch } from "@/components/AddressSearch";
import { ScheduleFields } from "@/components/ScheduleFields";
import { tileFor } from "@/components/DealCard";

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
  const { cart, isLoaded: cartLoaded, subtotalMinor, clearCart, syncWithLiveProducts, addItem, updateQuantity, removeItem, itemCount } = useCart();
  // The full address form is the canvas's "Edit" — it opens by itself while there's no pin yet.
  const [addrOpen, setAddrOpen] = useState(false);
  // The vendor's live catalogue, kept for the "Don't forget" row (other in-stock items not already in the bag).
  const [scheduleOk, setScheduleOk] = useState(true);
  const [vendorProducts, setVendorProducts] = useState<ProductDto[]>([]);

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
  // Separate draft text for the manual-entry inputs below — binding them
  // directly to lat/lng (numbers) meant every keystroke round-tripped
  // through Number(e.target.value), which silently drops a trailing "."
  // the instant it's typed ("8." -> Number -> 8 -> re-renders as "8").
  // These stay free text while being edited and only push a parsed number
  // up to lat/lng once it's valid; the effects below resync them whenever
  // lat/lng change from elsewhere (map drag, geolocation, address search).
  const [latText, setLatText] = useState("");
  const [lngText, setLngText] = useState("");
  useEffect(() => {
    setLatText(lat !== null ? String(lat) : "");
  }, [lat]);
  useEffect(() => {
    setLngText(lng !== null ? String(lng) : "");
  }, [lng]);
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

  // The spot chosen on /location (if any) is where the pin starts; everything below can still change it.
  const prefilledRef = useRef(false);
  useEffect(() => {
    if (prefilledRef.current) return;
    prefilledRef.current = true;
    const saved = getDeliveryLocation();
    if (!saved) return;
    setLat(saved.lat);
    setLng(saved.lng);
    setAddressLabel(saved.label);
    if (saved.landmark) setLandmark(saved.landmark);
  }, []);

  const isDelivery = cart.fulfilmentType === "delivery";
  const addOns = vendorProducts.filter((p) => p.stock > 0 && !cart.items.some((i) => i.productId === p.id)).slice(0, 6);

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
      .then((res) => {
        setVendorProducts(res.products);
        setCatalogChanges(syncWithLiveProducts(res.products));
      })
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
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 px-4 pb-8 pt-[18px]">
      <header className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={() => (window.history.length > 1 ? router.back() : router.push("/cart"))}
          aria-label="Back to bag"
          className="flex h-11 w-11 items-center justify-center rounded-[14px] bg-card text-ink"
        >
          <ArrowLeft size={18} strokeWidth={2.2} />
        </button>
        <h1 className="flex-1 text-[22px] font-semibold tracking-[-0.02em] text-ink">
          My bag <span className="text-muted">({itemCount})</span>
        </h1>
        <ThemeToggle />
      </header>

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

      <section className="rounded-[14px] bg-card px-3.5 py-1.5" aria-label="Your bag">
        {cart.items.map((item) => (
          <div key={item.productId} className="flex items-center gap-3 py-2.5">
            <span className={`flex h-[54px] w-[54px] shrink-0 items-center justify-center rounded-xl text-[#10231C] ${tileFor(item.productId)}`}>
              <ShoppingBag size={26} strokeWidth={1.5} aria-hidden="true" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-sm font-bold text-ink">{item.name}</span>
              <span className="text-[15px] font-semibold text-ink">{formatNaira(minor(item.priceMinor * item.quantity))}</span>
            </span>
            <span className="flex h-11 items-center rounded-[14px] bg-raised">
              <button
                type="button"
                onClick={() => (item.quantity <= 1 ? removeItem(item.productId) : updateQuantity(item.productId, item.quantity - 1))}
                aria-label={item.quantity <= 1 ? `Remove ${item.name}` : `Remove one ${item.name}`}
                className="flex h-11 w-8 items-center justify-center text-lg font-bold text-ink"
              >
                −
              </button>
              <span key={item.quantity} className="min-w-3 animate-bump text-center text-sm font-bold text-ink">
                {item.quantity}
              </span>
              <button
                type="button"
                onClick={() => updateQuantity(item.productId, item.quantity + 1)}
                disabled={item.quantity >= item.stock}
                aria-label={`Add one ${item.name}`}
                className="flex h-11 w-8 items-center justify-center text-lg font-bold text-ink disabled:opacity-40"
              >
                +
              </button>
            </span>
          </div>
        ))}
      </section>

      {addOns.length > 0 && (
        <section className="flex flex-col gap-2.5">
          <h2 className="text-[17px] font-semibold text-ink">Don&apos;t forget</h2>
          <div className="-mx-4 flex gap-2.5 overflow-x-auto px-4 [scrollbar-width:none]">
            {addOns.map((p) => (
              <div key={p.id} className="flex w-40 shrink-0 items-center gap-2 rounded-2xl bg-card p-2">
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl text-[#10231C] ${tileFor(p.id)}`}>
                  {p.images[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element -- external, vendor-supplied URLs
                    <img src={p.images[0]} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <ShoppingBag size={22} strokeWidth={1.5} aria-hidden="true" />
                  )}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-xs font-bold text-ink">{p.name}</span>
                  <span className="text-xs text-muted">{formatNaira(minor(p.priceMinor))}</span>
                </span>
                <button
                  type="button"
                  onClick={() =>
                    addItem(
                      { id: cart.vendor!.id, businessName: cart.vendor!.businessName, supportsPickup: cart.vendor!.supportsPickup },
                      { productId: p.id, name: p.name, priceMinor: p.priceMinor, stock: p.stock },
                    )
                  }
                  aria-label={`Add ${p.name}`}
                  className="flex h-11 w-9 shrink-0 items-center justify-center rounded-xl bg-accent text-[#10231C]"
                >
                  <Plus size={16} strokeWidth={2.6} />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {isDelivery ? (
        <section className="flex flex-col gap-3 rounded-[14px] bg-card p-3.5">
          <h2 className="text-[17px] font-semibold text-ink">Delivery</h2>
          <div className="flex items-center gap-2.5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-raised text-primary">
              <MapPin size={18} strokeWidth={2} aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1 text-sm text-ink">
              {lat === null
                ? "Set your delivery spot"
                : [addressLabel ?? `${lat.toFixed(4)}, ${lng?.toFixed(4)}`, landmark.trim() || null].filter(Boolean).join(" · ")}
            </span>
            {lat !== null && (
              <button type="button" onClick={() => setAddrOpen((v) => !v)} className="py-3 text-[13px] font-bold text-primary dark:text-[#8FD1B5]">
                {addrOpen ? "Done" : "Edit"}
              </button>
            )}
          </div>
          <ScheduleFields onValidityChange={setScheduleOk} />
          {(addrOpen || lat === null) && (
          <div className="flex flex-col gap-2 border-t border-line pt-3">

          {savedAddresses && savedAddresses.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {savedAddresses.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => selectSavedAddress(a)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                    selectedAddressId === a.id ? "border-primary bg-primary/10 text-primary" : "border-line text-ink"
                  }`}
                >
                  {a.label}
                </button>
              ))}
            </div>
          )}

          <AddressSearch onSelect={handleAddressSelected} />

          <div className="flex items-center gap-2 text-xs text-muted">
            <span className="h-px flex-1 bg-raised" />
            or
            <span className="h-px flex-1 bg-raised" />
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
                value={latText}
                onChange={(e) => {
                  const raw = e.target.value;
                  setLatText(raw);
                  const parsed = raw === "" ? null : Number(raw);
                  if (raw === "" || !Number.isNaN(parsed)) {
                    setLat(parsed);
                    setAccuracyMeters(null);
                    setAddressLabel(null);
                    setSelectedAddressId(null);
                  }
                }}
              />
              <Input
                placeholder="Longitude"
                inputMode="decimal"
                value={lngText}
                onChange={(e) => {
                  const raw = e.target.value;
                  setLngText(raw);
                  const parsed = raw === "" ? null : Number(raw);
                  if (raw === "" || !Number.isNaN(parsed)) {
                    setLng(parsed);
                    setAccuracyMeters(null);
                    setAddressLabel(null);
                    setSelectedAddressId(null);
                  }
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
          </div>
          )}
        </section>
      ) : (
        <section className="flex flex-col gap-3 rounded-[14px] bg-card p-3.5">
          <h2 className="text-[17px] font-semibold text-ink">Pickup</h2>
          <div className="flex items-center gap-2.5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-raised text-primary">
              <Store size={18} strokeWidth={2} aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1 text-sm text-ink">
              Collect from <span className="font-bold">{cart.vendor.businessName}</span>
            </span>
          </div>
          <ScheduleFields onValidityChange={setScheduleOk} />
        </section>
      )}

      <section className="flex flex-col gap-3 rounded-[14px] bg-card p-3.5">
        <h2 className="text-[17px] font-semibold text-ink">Contact</h2>
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

      <section className="flex flex-col gap-2 rounded-[14px] bg-card p-3.5">
        <h2 className="mb-1 text-[17px] font-semibold text-ink">Payment</h2>
        <PaymentOption
          label="Pay now"
          sub="Card or bank transfer, confirmed instantly"
          selected={paymentChoice === "online"}
          onSelect={() => setPaymentChoice("online")}
        />
        {isDelivery && (
          <PaymentOption
            label="Pay on delivery"
            sub="Cash to the rider at your door"
            selected={paymentChoice === "cash_on_delivery"}
            onSelect={() => setPaymentChoice("cash_on_delivery")}
          />
        )}
      </section>

      <section className="flex flex-col gap-2 rounded-[14px] bg-card p-3.5 text-sm">
        <div className="flex justify-between">
          <span className="text-muted">Subtotal</span>
          <span className="text-ink">{formatNaira(minor(subtotalMinor))}</span>
        </div>
        {isDelivery && (
          <div className="flex justify-between">
            <span className="text-muted">Delivery</span>
            <span className="text-ink">{deliveryFeeMinor === null ? "…" : formatNaira(minor(deliveryFeeMinor))}</span>
          </div>
        )}
        <div className="flex justify-between border-t border-line pt-2 text-base font-semibold">
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

      <button
        type="submit"
        disabled={isSubmitting || !scheduleOk}
        className="flex h-[60px] items-center justify-between rounded-[14px] bg-accent px-[22px] text-night transition-transform active:scale-[0.99] disabled:opacity-60"
      >
        <span className="text-base font-bold">{isSubmitting ? "Placing order…" : "Place order"}</span>
        <span className="text-[17px] font-semibold">{formatNaira(minor(totalMinor))}</span>
      </button>
    </form>
  );
}

function PaymentOption({ label, sub, selected, onSelect }: { label: string; sub: string; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex min-h-[58px] w-full items-center gap-3 rounded-[14px] px-3 py-2.5 text-left transition-colors ${
        selected ? "bg-raised shadow-[inset_0_0_0_2px_#FF5A19]" : "shadow-[inset_0_0_0_1px_rgb(var(--c-raised))]"
      }`}
    >
      <span className={`h-5 w-5 shrink-0 rounded-full ${selected ? "border-[6px] border-accent" : "border-2 border-muted/60"}`} />
      <span className="flex flex-1 flex-col gap-px">
        <span className="text-sm font-bold text-ink">{label}</span>
        <span className="text-xs text-muted">{sub}</span>
      </span>
    </button>
  );
}
