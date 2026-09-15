"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, useAuthSession } from "@closebuy/ui";
import { ApiClientError } from "@closebuy/api-client";
import { formatNaira, minor } from "@closebuy/types";
import type { CheckoutInput } from "@closebuy/types";
import { catalogApi, customerAuthApi, orderApi } from "@/lib/api";
import { useCart } from "@/lib/cart";

type PaymentChoice = "online" | "cash_on_delivery";

/**
 * screens-navigation.md §1.6. Address is a real pin (browser geolocation,
 * no API key needed) + landmark — never a postal string (brief §3.4). No
 * Google Maps preview here: GOOGLE_MAPS_API_KEY isn't configured in this
 * environment, and geolocation-only is a real, working, zero-dependency
 * substitute rather than a broken map embed. Server-side service-area
 * validation (US-C-05) still runs regardless — an outside-Riverpark pin
 * is rejected with a clear reason, not silently accepted.
 */
export default function CheckoutPage() {
  const router = useRouter();
  const { session, isLoaded: sessionLoaded } = useAuthSession();
  const { cart, isLoaded: cartLoaded, subtotalMinor, clearCart } = useCart();

  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [deliveryFeeMinor, setDeliveryFeeMinor] = useState<number | null>(null);

  const [contactPhone, setContactPhone] = useState("");
  const [alternateContactPhone, setAlternateContactPhone] = useState("");
  const [saveAsDefault, setSaveAsDefault] = useState(false);
  const [email, setEmail] = useState("");

  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [landmark, setLandmark] = useState("");
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  const [paymentChoice, setPaymentChoice] = useState<PaymentChoice>("online");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isDelivery = cart.fulfilmentType === "delivery";

  useEffect(() => {
    if (!cartLoaded) return;
    if (!cart.vendor || cart.items.length === 0) router.replace("/cart");
  }, [cartLoaded, cart.vendor, cart.items.length, router]);

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
        paymentMethod: paymentChoice === "cash_on_delivery" ? "cash_on_delivery" : "card",
        contactPhone: contactPhone.trim(),
        alternateContactPhone: alternateContactPhone.trim() || undefined,
        email: !session && paymentChoice === "online" ? email.trim() || undefined : undefined,
      };

      const result = await orderApi.checkout(input, idempotencyKey);

      if (session && saveAsDefault) {
        // Best-effort — never blocks a successful order on a profile-save failing.
        customerAuthApi.updateProfile({ defaultPhone: contactPhone.trim() }).catch(() => {});
      }

      clearCart();

      if (result.checkoutUrl) {
        window.location.href = result.checkoutUrl; // Monnify's hosted payment page
      } else {
        router.push(`/orders/track/${result.trackingToken}`);
      }
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Couldn't place your order. Try again.");
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5 p-4 pb-8">
      <h1 className="text-lg font-bold text-ink">Checkout</h1>

      {isDelivery ? (
        <section className="flex flex-col gap-2">
          <p className="text-sm font-medium text-ink">Delivery location</p>
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
            placeholder="e.g. Blue gate beside Corner Shop"
            value={landmark}
            onChange={(e) => setLandmark(e.target.value)}
            required
          />
        </section>
      ) : (
        <section className="rounded-lg bg-surface p-3 text-sm text-ink">
          Pickup from <span className="font-medium">{cart.vendor.businessName}</span>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <p className="text-sm font-medium text-ink">Contact</p>
        <Input
          label="Phone number"
          type="tel"
          value={contactPhone}
          onChange={(e) => setContactPhone(e.target.value)}
          placeholder="+2348012345678"
          required
        />
        <Input
          label="Alternate number (optional)"
          type="tel"
          value={alternateContactPhone}
          onChange={(e) => setAlternateContactPhone(e.target.value)}
          placeholder="+2348012345678"
        />
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

      {error && <p className="text-sm text-danger">{error}</p>}

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
