"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@closebuy/ui";
import { ApiClientError } from "@closebuy/api-client";
import { ArrowLeft, Star, Clock, MapPin } from "lucide-react";
import type { VendorDto, ProductDto } from "@closebuy/types";
import { catalogApi } from "@/lib/api";
import { useCart } from "@/lib/cart";
import { ProductCard } from "@/components/ProductCard";
import { QuickBuyCard } from "@/components/QuickBuyCard";
import { CartBar } from "@/components/CartBar";

/**
 * screens-navigation.md §1.3/1.4. No item-detail bottom sheet — Product
 * has no modifiers/options in the data model (data-model.md), so "Add"
 * is a direct one-tap action; quantity is then adjusted right on the
 * card, same as DoorDash's simple-item path. Products aren't grouped
 * into sections either — Product has no section field, just a flat list.
 */
export default function VendorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { cart, addItem, replaceCart, updateQuantity, setFulfilmentType } = useCart();

  const [vendor, setVendor] = useState<VendorDto | null>(null);
  const [products, setProducts] = useState<ProductDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflictProduct, setConflictProduct] = useState<ProductDto | null>(null);

  useEffect(() => {
    Promise.all([catalogApi.getVendor(id), catalogApi.getVendorProducts(id)])
      .then(([v, p]) => {
        setVendor(v.vendor);
        setProducts(p.products);
      })
      .catch((err) => setError(err instanceof ApiClientError ? err.message : "Couldn't load this vendor."));
  }, [id]);

  function quantityOf(productId: string) {
    return cart.items.find((i) => i.productId === productId)?.quantity ?? 0;
  }

  function handleAdd(product: ProductDto) {
    if (!vendor) return;
    const result = addItem(
      { id: vendor.id, businessName: vendor.businessName, supportsPickup: vendor.supportsPickup },
      { productId: product.id, name: product.name, priceMinor: product.priceMinor, stock: product.stock },
    );
    if (!result.added) setConflictProduct(product); // US-C-04 — a different vendor's items are already in the cart
  }

  function confirmReplace() {
    if (!vendor || !conflictProduct) return;
    replaceCart(
      { id: vendor.id, businessName: vendor.businessName, supportsPickup: vendor.supportsPickup },
      { productId: conflictProduct.id, name: conflictProduct.name, priceMinor: conflictProduct.priceMinor, stock: conflictProduct.stock },
    );
    setConflictProduct(null);
  }

  if (error) {
    return (
      <div className="p-4">
        <p className="text-sm text-danger">{error}</p>
      </div>
    );
  }

  if (!vendor || products === null) {
    return (
      <div className="flex flex-col gap-3 p-4">
        <div className="h-44 w-full animate-pulse rounded-2xl bg-surface" />
        <div className="h-6 w-2/3 animate-pulse rounded bg-surface" />
        <div className="h-4 w-1/3 animate-pulse rounded bg-surface" />
        <div className="h-20 w-full animate-pulse rounded-2xl bg-surface" />
        <div className="h-20 w-full animate-pulse rounded-2xl bg-surface" />
      </div>
    );
  }

  const canToggleFulfilment = vendor.supportsPickup && (!cart.vendor || cart.vendor.id === vendor.id);
  const quickBuyProducts = products.filter((p) => p.isQuickBuy && p.stock > 0);

  return (
    <div className="flex flex-col pb-28">
      <div className="relative flex h-44 w-full items-center justify-center bg-primary/10">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Back"
          className="absolute left-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-ink shadow-sm"
        >
          <ArrowLeft size={18} />
        </button>
        <span
          className={`absolute right-3 top-3 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wide shadow-sm ${
            vendor.isOpen ? "bg-success text-white" : "bg-white text-muted"
          }`}
        >
          {vendor.isOpen ? "Open" : "Closed"}
        </span>
        {vendor.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- external, vendor-supplied URL
          <img src={vendor.logoUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          // No logo yet — the business name stands in for a cover image
          // rather than leaving a blank box.
          <p className="px-4 text-center text-xl font-extrabold text-primary">{vendor.businessName}</p>
        )}
      </div>

      <div className="flex flex-col gap-3 p-4">
        <div>
          <h1 className="text-2xl font-bold text-ink">{vendor.businessName}</h1>
          <p className="text-sm font-medium text-muted">{vendor.category.name}</p>

          <div className="mt-2 flex items-center gap-3 text-xs font-medium text-muted">
            <span className="flex items-center gap-1">
              <Star size={14} className={vendor.ratingAverage != null ? "fill-accent text-accent" : "text-muted"} />
              <span className={vendor.ratingAverage != null ? "text-ink" : ""}>
                {vendor.ratingAverage != null ? `${vendor.ratingAverage.toFixed(1)} (${vendor.ratingCount})` : "New"}
              </span>
            </span>
            {vendor.avgDeliveryMinutes != null && (
              <span className="flex items-center gap-1">
                <Clock size={14} />
                {vendor.avgDeliveryMinutes} min
              </span>
            )}
          </div>
          <div className="mt-1.5 flex items-center gap-1 text-xs text-muted">
            <MapPin size={13} className="shrink-0" />
            <span className="truncate">{vendor.pickupLandmark}</span>
          </div>

          {vendor.description && <p className="mt-2.5 text-sm leading-snug text-ink">{vendor.description}</p>}
        </div>

        {canToggleFulfilment && (
          <div className="flex rounded-xl bg-surface p-1">
            <button type="button" onClick={() => setFulfilmentType("delivery")} className={toggleClass(cart.fulfilmentType === "delivery")}>
              Delivery
            </button>
            <button type="button" onClick={() => setFulfilmentType("pickup")} className={toggleClass(cart.fulfilmentType === "pickup")}>
              Pickup
            </button>
          </div>
        )}

        {!vendor.isOpen && (
          <p className="rounded-xl bg-warning/10 p-3 text-sm font-medium text-warning">
            This vendor is closed right now — you can browse, but ordering isn&apos;t available until they reopen.
          </p>
        )}

        {quickBuyProducts.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-base font-bold text-ink">Quick Buy</p>
            <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
              {quickBuyProducts.map((product) => (
                <QuickBuyCard key={product.id} product={product} onAdd={() => handleAdd(product)} />
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <p className="text-base font-bold text-ink">Menu</p>
          {products.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">No products listed yet.</p>
          ) : (
            products.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                quantity={quantityOf(product.id)}
                onAdd={() => handleAdd(product)}
                onIncrement={() => updateQuantity(product.id, quantityOf(product.id) + 1)}
                onDecrement={() => updateQuantity(product.id, quantityOf(product.id) - 1)}
              />
            ))
          )}
        </div>
      </div>

      {conflictProduct && (
        <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/40 sm:items-center">
          <div className="w-full max-w-lg rounded-t-2xl bg-white p-5 sm:rounded-2xl">
            <p className="font-semibold text-ink">Start a new cart?</p>
            <p className="mt-1 text-sm text-muted">
              Your cart has items from {cart.vendor?.businessName}. CloseBuy carts are one vendor at a time — adding
              from {vendor.businessName} will clear it.
            </p>
            <div className="mt-4 flex gap-2">
              <Button onClick={confirmReplace}>Clear cart and add</Button>
              <Button variant="secondary" onClick={() => setConflictProduct(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      <CartBar />
    </div>
  );
}

function toggleClass(active: boolean): string {
  return `flex-1 rounded-lg py-2 text-sm font-semibold transition ${active ? "bg-white text-ink shadow-sm" : "text-muted"}`;
}
