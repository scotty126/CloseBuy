"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@closebuy/ui";
import { ApiClientError } from "@closebuy/api-client";
import { ArrowLeft, Star, Clock, MapPin, Calendar, ShoppingBag, BookOpen, MessageCircle } from "lucide-react";
import type { VendorDto, ProductDto, VendorRatingDto } from "@closebuy/types";
import { catalogApi } from "@/lib/api";
import { useCart } from "@/lib/cart";
import { summarizeHours } from "@/lib/formatHours";
import { ProductCard } from "@/components/ProductCard";
import { ProductDetailSheet } from "@/components/ProductDetailSheet";
import { QuickBuyCard } from "@/components/QuickBuyCard";
import { CartBar } from "@/components/CartBar";

/**
 * screens-navigation.md §1.3/1.4, restyled toward the store-landing
 * reference the user shared (hero photo + an overlapping info sheet with
 * hours/days/pickup, Menu/Reviews tabs). No item-detail *packaging*
 * section though — Product has no modifiers in the data model, and a
 * container/packaging picker was explicitly scoped out (most CloseBuy
 * vendors are supermarkets/pharmacies, not restaurants — it doesn't
 * obviously fit the catalogue). The item sheet that exists
 * (ProductDetailSheet) is just the full image/description/price view.
 */
export default function VendorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { cart, addItem, replaceCart, updateQuantity, setFulfilmentType } = useCart();

  const [vendor, setVendor] = useState<VendorDto | null>(null);
  const [products, setProducts] = useState<ProductDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflictProduct, setConflictProduct] = useState<ProductDto | null>(null);
  const [detailProduct, setDetailProduct] = useState<ProductDto | null>(null);
  const [tab, setTab] = useState<"menu" | "reviews">("menu");
  const [ratings, setRatings] = useState<VendorRatingDto[] | null>(null);
  const [ratingsError, setRatingsError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([catalogApi.getVendor(id), catalogApi.getVendorProducts(id)])
      .then(([v, p]) => {
        setVendor(v.vendor);
        setProducts(p.products);
      })
      .catch((err) => setError(err instanceof ApiClientError ? err.message : "Couldn't load this vendor."));
  }, [id]);

  useEffect(() => {
    if (tab !== "reviews" || ratings !== null) return;
    catalogApi
      .getVendorRatings(id)
      .then((res) => setRatings(res.ratings))
      .catch((err) => setRatingsError(err instanceof ApiClientError ? err.message : "Couldn't load reviews."));
  }, [tab, ratings, id]);

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
  const hours = summarizeHours(vendor.openingHours);

  return (
    <div className="flex flex-col pb-28">
      <div className="relative flex h-52 w-full shrink-0 items-center justify-center bg-primary/10">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Back"
          className="absolute left-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-ink shadow-sm"
        >
          <ArrowLeft size={18} />
        </button>
        {vendor.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- external, vendor-supplied URL
          <img src={vendor.logoUrl} alt="" className="h-full w-full object-contain" />
        ) : (
          // No logo yet — the business name stands in for a cover image
          // rather than leaving a blank box.
          <p className="px-4 text-center text-xl font-extrabold text-primary">{vendor.businessName}</p>
        )}
      </div>

      {/* Overlaps the hero's bottom edge, matching the store-landing reference. */}
      <div className="-mt-5 rounded-t-3xl bg-paper px-4 pb-4 pt-4 shadow-[0_-4px_12px_rgba(0,0,0,0.04)]">
        <div className="flex flex-col gap-3">
          <div>
            <div className="flex items-start justify-between gap-2">
              <h1 className="text-2xl font-bold text-ink">{vendor.businessName}</h1>
              <span
                className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wide ${
                  vendor.isOpen ? "bg-success text-white" : "bg-surface text-muted"
                }`}
              >
                {vendor.isOpen ? "Open" : "Closed"}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-1 text-xs text-muted">
              <MapPin size={13} className="shrink-0" />
              <span className="truncate">{vendor.pickupLandmark}</span>
            </div>
            <div className="mt-1.5 flex items-center gap-3 text-xs font-medium text-muted">
              <span className="flex items-center gap-1">
                <Star size={14} className={vendor.ratingAverage != null ? "fill-accent text-accent" : "text-muted"} />
                <span className={vendor.ratingAverage != null ? "text-ink" : ""}>
                  {vendor.ratingAverage != null ? `${vendor.ratingAverage.toFixed(1)} (${vendor.ratingCount} reviews)` : "New"}
                </span>
              </span>
              {vendor.avgDeliveryMinutes != null && (
                <span className="flex items-center gap-1">
                  <Clock size={14} />
                  {vendor.avgDeliveryMinutes} min
                </span>
              )}
            </div>
            {vendor.description && <p className="mt-2.5 text-sm leading-snug text-ink">{vendor.description}</p>}
          </div>

          {hours && (
            <div className="flex flex-col gap-2 rounded-xl border border-gray-200 p-3">
              <div className="flex items-center gap-2.5 text-sm">
                <Clock size={16} className="shrink-0 text-muted" />
                <span className="text-muted">Hours</span>
                <span className="ml-auto font-medium text-ink">{hours.today}</span>
              </div>
              <div className="flex items-center gap-2.5 border-t border-gray-100 pt-2 text-sm">
                <Calendar size={16} className="shrink-0 text-muted" />
                <span className="text-muted">Days</span>
                <span className="ml-auto font-medium text-ink">{hours.days}</span>
              </div>
              <div className="flex items-center gap-2.5 border-t border-gray-100 pt-2 text-sm">
                <ShoppingBag size={16} className="shrink-0 text-muted" />
                <span className="text-muted">Pickup</span>
                <span className="ml-auto font-medium text-ink">{vendor.supportsPickup ? "Delivery + Pickup" : "Delivery only"}</span>
              </div>
            </div>
          )}

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

          <div className="flex rounded-xl bg-surface p-1">
            <button type="button" onClick={() => setTab("menu")} className={`${toggleClass(tab === "menu")} flex items-center justify-center gap-1.5`}>
              <BookOpen size={15} /> Menu
            </button>
            <button
              type="button"
              onClick={() => setTab("reviews")}
              className={`${toggleClass(tab === "reviews")} flex items-center justify-center gap-1.5`}
            >
              <MessageCircle size={15} /> Reviews
            </button>
          </div>
        </div>

        {tab === "menu" ? (
          <div className="mt-3 flex flex-col gap-3">
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
                    onOpenDetail={() => setDetailProduct(product)}
                  />
                ))
              )}
            </div>
          </div>
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            {ratingsError ? (
              <p className="py-8 text-center text-sm text-danger">{ratingsError}</p>
            ) : ratings === null ? (
              <div className="flex flex-col gap-2">
                {[0, 1].map((i) => (
                  <div key={i} className="h-16 animate-pulse rounded-2xl bg-surface" />
                ))}
              </div>
            ) : ratings.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted">No reviews yet.</p>
            ) : (
              ratings.map((r) => (
                <div key={r.id} className="rounded-2xl border border-gray-200 bg-white p-3.5 shadow-sm">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-ink">Customer</p>
                    <div className="flex gap-0.5">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <Star key={n} size={13} className={n <= r.score ? "fill-accent text-accent" : "text-gray-300"} />
                      ))}
                    </div>
                  </div>
                  {r.comment && <p className="mt-1 text-sm text-ink">{r.comment}</p>}
                  <p className="mt-1 text-xs text-muted">{new Date(r.createdAt).toLocaleDateString()}</p>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {detailProduct && (
        <ProductDetailSheet
          product={detailProduct}
          quantity={quantityOf(detailProduct.id)}
          onAdd={() => handleAdd(detailProduct)}
          onIncrement={() => updateQuantity(detailProduct.id, quantityOf(detailProduct.id) + 1)}
          onDecrement={() => updateQuantity(detailProduct.id, quantityOf(detailProduct.id) - 1)}
          onClose={() => setDetailProduct(null)}
        />
      )}

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
