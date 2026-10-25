"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@closebuy/ui";
import type { ProductListingDto } from "@closebuy/types";
import { useCart } from "@/lib/cart";

/**
 * Add-to-cart for a product shown outside its own vendor page (Home deals,
 * Search results, Favourites), where there's no loaded `VendorDto` to hand.
 * Carries the same US-C-04 single-vendor-cart guard the storefront has: if the
 * cart already holds a different vendor's items it asks before clearing it,
 * instead of silently swapping carts.
 */
export function useQuickAdd(): { add: (p: ProductListingDto) => void; dialog: ReactNode } {
  const { cart, addItem, replaceCart } = useCart();
  const [pending, setPending] = useState<ProductListingDto | null>(null);

  const toVendor = (p: ProductListingDto) => ({ id: p.vendorId, businessName: p.vendorName, supportsPickup: p.vendorSupportsPickup });
  const toItem = (p: ProductListingDto) => ({ productId: p.id, name: p.name, priceMinor: p.priceMinor, stock: p.stock });

  function add(p: ProductListingDto) {
    const result = addItem(toVendor(p), toItem(p));
    if (!result.added) setPending(p);
  }

  const dialog = pending ? (
    <div className="fixed inset-0 z-40 flex animate-fade-in items-end justify-center bg-black/40 sm:items-center">
      <div className="w-full max-w-lg rounded-t-2xl bg-card p-5 sm:rounded-2xl">
        <p className="font-semibold text-ink">Start a new bag?</p>
        <p className="mt-1 text-sm text-muted">
          Your bag has items from {cart.vendor?.businessName}. CloseBuy bags are one shop at a time — adding from{" "}
          {pending.vendorName} will clear it.
        </p>
        <div className="mt-4 flex gap-2">
          <Button
            onClick={() => {
              replaceCart(toVendor(pending), toItem(pending));
              setPending(null);
            }}
          >
            Clear bag and add
          </Button>
          <Button variant="secondary" onClick={() => setPending(null)}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  ) : null;

  return { add, dialog };
}
