"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button, ThemeToggle } from "@closebuy/ui";
import { ApiClientError } from "@closebuy/api-client";
import { ArrowLeft, Clock, Heart, Store } from "lucide-react";
import { formatNaira, minor } from "@closebuy/types";
import type { CategoryDto, ProductDto, VendorDto, VendorRatingDto } from "@closebuy/types";
import { catalogApi } from "@/lib/api";
import { useCart } from "@/lib/cart";
import { useFavorites } from "@/lib/favorites";
import { summarizeHours } from "@/lib/formatHours";
import { discountOff } from "@/components/DealCard";
import { ShopProductCard } from "@/components/ShopProductCard";
import { ProductDetailSheet } from "@/components/ProductDetailSheet";
import { CartBar } from "@/components/CartBar";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * screens-navigation.md §1.3/1.4, in the redesign's shape: breadcrumb header
 * with follow + theme, cover, mono status line, stat strip, sale strip,
 * Menu/Reviews tabs, aisle chips and a 2-up product grid. The item sheet
 * (ProductDetailSheet) is the full image/description/price view — Product has
 * no modifiers, so there is no packaging/size step to put in it.
 */
export default function VendorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { cart, addItem, replaceCart, updateQuantity } = useCart();
  const { isFollowing, toggleFollow } = useFavorites();

  const [vendor, setVendor] = useState<VendorDto | null>(null);
  const [products, setProducts] = useState<ProductDto[] | null>(null);
  const [categories, setCategories] = useState<CategoryDto[]>([]);
  const [feeMinor, setFeeMinor] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflictProduct, setConflictProduct] = useState<ProductDto | null>(null);
  const [detailProduct, setDetailProduct] = useState<ProductDto | null>(null);
  const [tab, setTab] = useState<"menu" | "reviews">("menu");
  const [aisle, setAisle] = useState<string | null>(null);
  const [ratings, setRatings] = useState<VendorRatingDto[] | null>(null);
  const [distribution, setDistribution] = useState<Record<number, number> | null>(null);
  const [ratingsError, setRatingsError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([catalogApi.getVendor(id), catalogApi.getVendorProducts(id)])
      .then(([v, p]) => {
        setVendor(v.vendor);
        setProducts(p.products);
      })
      .catch((err) => setError(err instanceof ApiClientError ? err.message : "Couldn't load this shop."));
    catalogApi.listCategories().then((res) => setCategories(res.categories)).catch(() => {});
    catalogApi.getDeliveryFee().then((res) => setFeeMinor(res.feeMinor)).catch(() => {});
  }, [id]);

  useEffect(() => {
    if (tab !== "reviews" || ratings !== null) return;
    catalogApi
      .getVendorRatings(id)
      .then((res) => {
        setRatings(res.ratings);
        setDistribution(res.distribution ?? null);
      })
      .catch((err) => setRatingsError(err instanceof ApiClientError ? err.message : "Couldn't load reviews."));
  }, [tab, ratings, id]);

  const aisles = useMemo(() => {
    if (!products) return [];
    const counts = new Map<string, number>();
    for (const p of products) counts.set(p.categoryId, (counts.get(p.categoryId) ?? 0) + 1);
    return [...counts.entries()].map(([categoryId, n]) => ({ categoryId, n, name: categories.find((c) => c.id === categoryId)?.name ?? "Other" }));
  }, [products, categories]);

  function quantityOf(productId: string) {
    return cart.items.find((i) => i.productId === productId)?.quantity ?? 0;
  }

  function handleAdd(product: ProductDto) {
    if (!vendor) return;
    const result = addItem(
      { id: vendor.id, businessName: vendor.businessName, supportsPickup: vendor.supportsPickup },
      { productId: product.id, name: product.name, priceMinor: product.priceMinor, stock: product.stock },
    );
    if (!result.added) setConflictProduct(product); // US-C-04 — a different shop's items are already in the bag
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
        <div className="h-[150px] w-full animate-pulse rounded-[14px] bg-raised" />
        <div className="h-6 w-2/3 animate-pulse rounded bg-raised" />
        <div className="h-16 w-full animate-pulse rounded-xl bg-raised" />
        <div className="grid grid-cols-2 gap-2.5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-48 animate-pulse rounded-[14px] bg-raised" />
          ))}
        </div>
      </div>
    );
  }

  const hours = summarizeHours(vendor.openingHours);
  const following = isFollowing(vendor.id);
  const bestOff = products.reduce((m, p) => Math.max(m, p.stock > 0 ? discountOff(p) : 0), 0);
  const visible = aisle ? products.filter((p) => p.categoryId === aisle) : products;
  const total = ratings?.length ? distribution && Object.values(distribution).reduce((s, n) => s + n, 0) : 0;

  return (
    <div className="flex flex-col pb-40">
      <header className="flex items-center gap-1.5 border-b border-line p-2">
        <button type="button" onClick={() => (window.history.length > 1 ? router.back() : router.push("/"))} aria-label="Back" className="flex h-11 w-11 items-center justify-center text-ink">
          <ArrowLeft size={18} strokeWidth={2} />
        </button>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted">
          shops / {slug(vendor.category.name)} / <span className="text-ink">{slug(vendor.businessName)}</span>
        </span>
        <ThemeToggle className="!bg-transparent !shadow-none" />
        <button
          type="button"
          onClick={() => toggleFollow(vendor.id)}
          aria-label={following ? "Unfollow shop" : "Follow shop"}
          aria-pressed={following}
          className="flex h-11 w-11 items-center justify-center transition-transform active:scale-90"
        >
          <Heart size={17} strokeWidth={1.8} className={following ? "fill-accent text-accent" : "text-ink"} />
        </button>
      </header>

      <div className="px-4 pt-3.5">
        <div className="relative flex h-[150px] items-center justify-center overflow-hidden rounded-[14px] bg-raised shadow-[inset_0_0_0_1px_rgb(var(--c-line))]">
          {!vendor.logoUrl && (
            <svg width="100%" height="100%" aria-hidden="true" className="absolute inset-0 opacity-50">
              <defs>
                <pattern id="shop-grid" width="16" height="16" patternUnits="userSpaceOnUse">
                  <path d="M16 0H0V16" fill="none" stroke="rgb(var(--c-line))" strokeWidth="1" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#shop-grid)" />
            </svg>
          )}
          {vendor.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- external, vendor-supplied URL
            <img src={vendor.logoUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="relative flex items-center gap-1.5 px-4 text-center font-mono text-[11px] text-muted">
              <Store size={16} strokeWidth={1.8} aria-hidden="true" />
              {vendor.businessName}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2.5 px-4 pt-3.5">
        <span className="flex items-center gap-1.5 font-mono text-[11px] uppercase text-muted">
          <span className={`h-1.5 w-1.5 rounded-full ${vendor.isOpen ? "bg-success" : "bg-muted"}`} aria-hidden="true" />
          {vendor.isOpen ? "Open" : "Closed"} · {vendor.category.name} · Riverpark
        </span>
        <h1 className="text-2xl font-semibold tracking-[-0.03em] text-ink">{vendor.businessName}</h1>

        <div className="grid grid-cols-3 overflow-hidden rounded-xl bg-card shadow-[0_0_0_1px_rgb(var(--c-line))]">
          <Stat label="Rating" value={vendor.ratingAverage != null ? `★ ${vendor.ratingAverage.toFixed(1)}` : "New"} />
          <Stat label="ETA" value={vendor.avgDeliveryMinutes != null ? `${vendor.avgDeliveryMinutes} min` : "—"} bordered />
          <Stat label="Fee" value={feeMinor != null ? formatNaira(minor(feeMinor)) : "—"} bordered />
        </div>

        {bestOff > 0 && (
          <div className="flex items-center gap-2.5 rounded-xl bg-[#FDE7DB] p-2.5 text-[13px] text-ink dark:bg-[#2A1A12]">
            <span className="rounded-md bg-accent px-1.5 py-0.5 font-mono text-[11px] text-[#0E1F19]">−{bestOff}%</span>
            <span>On selected items right now</span>
          </div>
        )}

        {hours && !vendor.isOpen && (
          <p className="flex items-center gap-2 text-xs text-muted">
            <Clock size={13} aria-hidden="true" />
            Today {hours.today}
          </p>
        )}

        {!vendor.isOpen && (
          <p className="rounded-xl bg-warning/10 p-3 text-sm font-medium text-warning">
            This shop is closed right now — you can browse, but ordering isn&apos;t available until they reopen.
          </p>
        )}

        <div role="tablist" className="grid grid-cols-2 rounded-[11px] bg-card p-[3px] shadow-[inset_0_0_0_1px_rgb(var(--c-line))]">
          {(["menu", "reviews"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`h-[38px] rounded-lg text-[13px] transition-colors ${tab === t ? "bg-raised font-semibold" : "font-normal"} text-ink`}
            >
              {t === "menu" ? "Menu" : `Reviews${vendor.ratingAverage != null ? ` · ${vendor.ratingAverage.toFixed(1)}` : ""}`}
            </button>
          ))}
        </div>
      </div>

      {tab === "menu" ? (
        <>
          {aisles.length > 1 && (
            <div className="sticky top-0 z-[2] flex gap-1.5 overflow-x-auto bg-surface px-4 pb-2.5 pt-3.5 [scrollbar-width:none]">
              <AisleChip label="All" n={products.length} on={aisle === null} onClick={() => setAisle(null)} />
              {aisles.map((a) => (
                <AisleChip key={a.categoryId} label={a.name} n={a.n} on={aisle === a.categoryId} onClick={() => setAisle(a.categoryId)} />
              ))}
            </div>
          )}
          {visible.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted">No products listed yet.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2.5 px-4 pt-1 lg:grid-cols-4 lg:gap-3">
              {visible.map((product) => (
                <ShopProductCard
                  key={product.id}
                  product={product}
                  quantity={quantityOf(product.id)}
                  onAdd={() => handleAdd(product)}
                  onIncrement={() => updateQuantity(product.id, quantityOf(product.id) + 1)}
                  onDecrement={() => updateQuantity(product.id, quantityOf(product.id) - 1)}
                  onOpenDetail={() => setDetailProduct(product)}
                />
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-col gap-3 px-4 pt-3.5">
          {ratingsError ? (
            <p className="py-8 text-center text-sm text-danger">{ratingsError}</p>
          ) : ratings === null ? (
            <div className="flex flex-col gap-2">
              {[0, 1].map((i) => (
                <div key={i} className="h-16 animate-pulse rounded-[14px] bg-raised" />
              ))}
            </div>
          ) : ratings.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">No reviews yet.</p>
          ) : (
            <>
              <div className="flex items-center gap-3.5 rounded-[14px] bg-card p-3.5 shadow-[inset_0_0_0_1px_rgb(var(--c-line))]">
                <span className="flex flex-col items-center gap-0.5 border-r border-line pr-3.5">
                  <span className="font-mono text-[28px] font-semibold text-ink">{vendor.ratingAverage?.toFixed(1) ?? "—"}</span>
                  <span className="font-mono text-[10px] uppercase text-muted">{vendor.ratingCount} reviews</span>
                </span>
                {distribution && (
                  <span className="flex flex-1 flex-col gap-1">
                    {[5, 4, 3, 2, 1].map((n) => (
                      <span key={n} className="grid grid-cols-[14px_1fr] items-center gap-2 font-mono text-[10px] text-muted">
                        {n}
                        <span className="h-[5px] overflow-hidden rounded-[3px] bg-raised">
                          <span
                            className="block h-[5px] rounded-[3px] bg-accent"
                            style={{ width: `${total ? Math.round(((distribution[n] ?? 0) / total) * 100) : 0}%` }}
                          />
                        </span>
                      </span>
                    ))}
                  </span>
                )}
              </div>
              {ratings.map((r) => (
                <article key={r.id} className="flex flex-col gap-1.5 rounded-[14px] bg-card px-3.5 py-3 shadow-[inset_0_0_0_1px_rgb(var(--c-line))]">
                  <span className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-ink">Customer</span>
                    <span className="font-mono text-[11px] text-accent">{"★".repeat(r.score)}</span>
                    <span className="ml-auto font-mono text-[10px] text-muted">{new Date(r.createdAt).toLocaleDateString()}</span>
                  </span>
                  {r.comment && <span className="text-[13px] leading-normal text-ink">{r.comment}</span>}
                </article>
              ))}
            </>
          )}
        </div>
      )}

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
        <div className="fixed inset-0 z-40 flex animate-fade-in items-end justify-center bg-black/40 sm:items-center">
          <div className="w-full max-w-lg rounded-t-2xl bg-card p-5 sm:rounded-2xl">
            <p className="font-semibold text-ink">Start a new bag?</p>
            <p className="mt-1 text-sm text-muted">
              Your bag has items from {cart.vendor?.businessName}. CloseBuy bags are one shop at a time — adding from {vendor.businessName} will clear it.
            </p>
            <div className="mt-4 flex gap-2">
              <Button onClick={confirmReplace}>Clear bag and add</Button>
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

function Stat({ label, value, bordered }: { label: string; value: string; bordered?: boolean }) {
  return (
    <span className={`flex flex-col gap-0.5 px-3 py-2.5 ${bordered ? "border-l border-line" : ""}`}>
      <span className="font-mono text-[10px] uppercase text-muted">{label}</span>
      <span className="font-mono text-sm font-semibold text-ink">{value}</span>
    </span>
  );
}

function AisleChip({ label, n, on, onClick }: { label: string; n: number; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`flex h-9 shrink-0 items-center gap-2 rounded-[9px] pl-3 pr-1.5 text-[13px] font-medium ${
        on ? "bg-ink text-surface shadow-[inset_0_0_0_1px_rgb(var(--c-ink))]" : "bg-card text-ink shadow-[inset_0_0_0_1px_rgb(var(--c-line))]"
      }`}
    >
      {label}
      <span className={`rounded-md px-1.5 py-0.5 font-mono text-[11px] ${on ? "bg-accent text-[#0E1F19]" : "bg-raised text-muted"}`}>{n}</span>
    </button>
  );
}

