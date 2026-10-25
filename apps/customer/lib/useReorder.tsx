"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@closebuy/ui";
import { ApiClientError } from "@closebuy/api-client";
import type { OrderDto } from "@closebuy/types";
import { catalogApi } from "@/lib/api";
import { useCart, type CartItem, type CartVendor } from "@/lib/cart";

/**
 * US-C-09 — "any past order can be reordered, subject to current stock and
 * price": re-fetches the vendor's live catalogue (never trusts the order's own
 * priceMinorSnapshot/nameSnapshot — those are a receipt of what happened then,
 * not what's buyable now) and drops any item that's gone inactive or sold out,
 * rather than failing the whole reorder. Shared by the tracking page and the
 * order-history cards. If the bag already holds a different shop's items it
 * asks before replacing them.
 */
export function useReorder(): {
  reorder: (order: Pick<OrderDto, "vendorId" | "items">) => Promise<void>;
  busy: boolean;
  error: string | null;
  notice: string | null;
  dialog: ReactNode;
} {
  const router = useRouter();
  const { cart, replaceCartItems } = useCart();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ vendor: CartVendor; items: CartItem[] } | null>(null);

  async function reorder(order: Pick<OrderDto, "vendorId" | "items">) {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const [{ vendor }, { products }] = await Promise.all([catalogApi.getVendor(order.vendorId), catalogApi.getVendorProducts(order.vendorId)]);

      const items: CartItem[] = [];
      for (const orderItem of order.items) {
        const product = products.find((p) => p.id === orderItem.productId);
        if (!product || product.stock <= 0) continue;
        items.push({
          productId: product.id,
          name: product.name,
          priceMinor: product.priceMinor,
          stock: product.stock,
          quantity: Math.min(orderItem.quantity, product.stock),
        });
      }
      const cartVendor: CartVendor = { id: vendor.id, businessName: vendor.businessName, supportsPickup: vendor.supportsPickup };

      if (items.length === 0) {
        setError("None of these items are available anymore.");
        return;
      }
      if (cart.vendor && cart.vendor.id !== cartVendor.id) {
        setConflict({ vendor: cartVendor, items });
        return;
      }

      replaceCartItems(cartVendor, items);
      const skipped = order.items.length - items.length;
      if (skipped > 0) setNotice(`${skipped} item${skipped === 1 ? " is" : "s are"} no longer available and ${skipped === 1 ? "was" : "were"} left out.`);
      else router.push("/cart");
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Couldn't reorder this.");
    } finally {
      setBusy(false);
    }
  }

  const dialog = conflict ? (
    <div className="fixed inset-0 z-40 flex animate-fade-in items-end justify-center bg-black/40 sm:items-center">
      <div className="w-full max-w-lg rounded-t-2xl bg-card p-5 sm:rounded-2xl">
        <p className="font-semibold text-ink">Replace your bag?</p>
        <p className="mt-1 text-sm text-muted">
          Your bag has items from {cart.vendor?.businessName}. Reordering replaces it with this order&apos;s items from {conflict.vendor.businessName}.
        </p>
        <div className="mt-4 flex gap-2">
          <Button
            onClick={() => {
              replaceCartItems(conflict.vendor, conflict.items);
              setConflict(null);
              router.push("/cart");
            }}
          >
            Replace bag
          </Button>
          <Button variant="secondary" onClick={() => setConflict(null)}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  ) : null;

  return { reorder, busy, error, notice, dialog };
}
