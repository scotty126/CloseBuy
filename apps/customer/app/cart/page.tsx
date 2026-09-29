"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@closebuy/ui";
import { ShoppingBag } from "lucide-react";
import { formatNaira, minor } from "@closebuy/types";
import { useCart } from "@/lib/cart";

/**
 * screens-navigation.md §1.5. Delivery fee isn't shown here — it's a
 * platform Config value (flat_delivery_fee_minor) with no public read
 * endpoint, computed server-side at checkout; showing a guessed number
 * here would be worse than not showing one. Scheduling isn't constrained
 * to the vendor's actual opening hours either — VendorProfile.openingHours
 * has no admin/vendor UI to ever populate it yet (M2's Store Settings
 * screen, still unbuilt), so there's nothing real to constrain against.
 */
export default function CartPage() {
  const router = useRouter();
  const { cart, isLoaded, subtotalMinor, updateQuantity, removeItem, setFulfilmentType, setScheduledFor, clearCart } = useCart();
  const [scheduleMode, setScheduleMode] = useState<"asap" | "later">(cart.scheduledFor ? "later" : "asap");

  if (!isLoaded) return null;

  if (!cart.vendor || cart.items.length === 0) {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center gap-3 p-4 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-surface text-muted">
          <ShoppingBag size={28} />
        </span>
        <p className="text-base font-bold text-ink">Your cart is empty</p>
        <p className="text-sm text-muted">Add something from a vendor to see it here.</p>
        <Link href="/" className="mt-1">
          <Button>Browse vendors</Button>
        </Link>
      </div>
    );
  }

  const minDateTime = new Date(Date.now() + 15 * 60 * 1000).toISOString().slice(0, 16); // at least 15 min out

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-ink">Your cart</h1>
        <button type="button" onClick={clearCart} className="text-xs font-semibold text-muted underline">
          Clear cart
        </button>
      </div>

      <p className="text-sm font-medium text-muted">From {cart.vendor.businessName}</p>

      <div className="flex flex-col divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white shadow-sm">
        {cart.items.map((item) => (
          <div key={item.productId} className="flex items-center gap-3 p-3.5">
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-ink">{item.name}</p>
              <p className="text-sm font-bold text-accent">{formatNaira(minor(item.priceMinor))}</p>
            </div>
            <div className="flex items-center gap-2 rounded-full bg-surface px-1 py-1">
              <button
                type="button"
                onClick={() => updateQuantity(item.productId, item.quantity - 1)}
                aria-label={`Remove one ${item.name}`}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-ink shadow-sm"
              >
                −
              </button>
              <span className="w-4 text-center text-sm font-bold text-ink">{item.quantity}</span>
              <button
                type="button"
                onClick={() => updateQuantity(item.productId, item.quantity + 1)}
                disabled={item.quantity >= item.stock}
                aria-label={`Add one more ${item.name}`}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-white shadow-sm disabled:opacity-40"
              >
                +
              </button>
            </div>
            <button type="button" onClick={() => removeItem(item.productId)} className="text-xs font-semibold text-muted underline">
              Remove
            </button>
          </div>
        ))}
      </div>

      {cart.vendor.supportsPickup && (
        <div>
          <p className="mb-1.5 text-sm font-bold text-ink">Fulfilment</p>
          <div className="flex rounded-xl bg-surface p-1">
            <button
              type="button"
              onClick={() => setFulfilmentType("delivery")}
              className={toggleClass(cart.fulfilmentType === "delivery")}
            >
              Delivery
            </button>
            <button
              type="button"
              onClick={() => setFulfilmentType("pickup")}
              className={toggleClass(cart.fulfilmentType === "pickup")}
            >
              Pickup
            </button>
          </div>
        </div>
      )}

      <div>
        <p className="mb-1.5 text-sm font-bold text-ink">When</p>
        <div className="flex rounded-xl bg-surface p-1">
          <button
            type="button"
            onClick={() => {
              setScheduleMode("asap");
              setScheduledFor(null);
            }}
            className={toggleClass(scheduleMode === "asap")}
          >
            As soon as possible
          </button>
          <button type="button" onClick={() => setScheduleMode("later")} className={toggleClass(scheduleMode === "later")}>
            Schedule
          </button>
        </div>
        {scheduleMode === "later" && (
          <input
            type="datetime-local"
            min={minDateTime}
            value={cart.scheduledFor ? cart.scheduledFor.slice(0, 16) : ""}
            onChange={(e) => setScheduledFor(e.target.value ? new Date(e.target.value).toISOString() : null)}
            className="mt-2 w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
          />
        )}
      </div>

      <div className="flex items-center justify-between rounded-2xl border border-gray-200 bg-white p-3.5 shadow-sm">
        <span className="text-sm font-medium text-muted">Subtotal</span>
        <span className="text-base font-bold text-ink">{formatNaira(minor(subtotalMinor))}</span>
      </div>
      <p className="-mt-2 text-xs text-muted">
        {cart.fulfilmentType === "delivery" ? "Delivery fee added at checkout." : "No delivery fee — you're picking up."}
      </p>

      <Button
        onClick={() => router.push("/checkout")}
        disabled={scheduleMode === "later" && !cart.scheduledFor}
      >
        Proceed to checkout
      </Button>
    </div>
  );
}

function toggleClass(active: boolean): string {
  return `flex-1 rounded-lg py-2 text-sm font-semibold transition ${active ? "bg-white text-ink shadow-sm" : "text-muted"}`;
}
