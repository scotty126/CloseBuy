"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ApiClientError } from "@closebuy/api-client";
import { ArrowLeft, ChevronRight, Heart, ShoppingBag, ShoppingBasket } from "lucide-react";
import { Button, ThemeToggle } from "@closebuy/ui";
import { formatNaira, minor } from "@closebuy/types";
import type { ProductListingDto, VendorDto } from "@closebuy/types";
import { catalogApi } from "@/lib/api";
import { useCart } from "@/lib/cart";
import { useFavorites } from "@/lib/favorites";
import { discountOff, tileFor } from "@/components/DealCard";

export default function ProductPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { cart, addItem, replaceCart } = useCart();
  const { isFavorite, toggle } = useFavorites();

  const [product, setProduct] = useState<ProductListingDto | null>(null);
  const [pairs, setPairs] = useState<ProductListingDto[]>([]);
  const [vendor, setVendor] = useState<VendorDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [conflict, setConflict] = useState(false);
  const [photo, setPhoto] = useState(0);

  useEffect(() => {
    catalogApi
      .getProduct(id)
      .then((res) => {
        setProduct(res.product);
        setPairs(res.pairsWith);
        catalogApi.getVendor(res.product.vendorId).then((v) => setVendor(v.vendor)).catch(() => {});
      })
      .catch((err) => setError(err instanceof ApiClientError ? err.message : "Couldn't load this product."));
  }, [id]);

  if (error) {
    return (
      <div className="flex flex-col gap-3 p-4">
        <Link href="/" className="text-sm font-medium text-primary">
          ← Back home
        </Link>
        <p className="text-sm text-danger">{error}</p>
      </div>
    );
  }
  if (!product) {
    return (
      <div className="flex flex-col gap-3 p-4">
        <div className="h-80 animate-pulse rounded-2xl bg-raised" />
        <div className="h-8 w-2/3 animate-pulse rounded-lg bg-raised" />
      </div>
    );
  }

  const off = discountOff(product);
  const favorite = isFavorite(product.id);
  const soldOut = product.stock === 0;
  const maxQty = Math.max(product.stock, 1);
  const extras = pairs.filter((p) => picked.has(p.id));
  const total = product.priceMinor * qty + extras.reduce((s, p) => s + p.priceMinor, 0);
  const vendorRef = { id: product.vendorId, businessName: product.vendorName, supportsPickup: product.vendorSupportsPickup };
  const item = (p: ProductListingDto) => ({ productId: p.id, name: p.name, priceMinor: p.priceMinor, stock: p.stock });

  function addEverythingAfterMain() {
    for (const p of extras) addItem(vendorRef, item(p));
    router.push("/cart");
  }

  function handleAddToBag() {
    if (!product || soldOut) return;
    const result = addItem(vendorRef, item(product), qty);
    if (!result.added) {
      setConflict(true); // US-C-04 — a different shop's items are already in the bag
      return;
    }
    addEverythingAfterMain();
  }

  function confirmReplace() {
    if (!product) return;
    replaceCart(vendorRef, item(product), qty);
    setConflict(false);
    addEverythingAfterMain();
  }

  function togglePair(pid: string) {
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(pid)) next.delete(pid);
      else next.add(pid);
      return next;
    });
  }

  const photos = product.images;

  return (
    <div className="relative flex flex-col">
      <div className={`relative h-[330px] ${tileFor(product.id)}`}>
        {photos.length > 0 ? (
          <div
            className="flex h-full snap-x snap-mandatory overflow-x-auto [scrollbar-width:none]"
            onScroll={(e) => setPhoto(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}
          >
            {photos.map((src) => (
              // eslint-disable-next-line @next/next/no-img-element -- external, vendor-supplied URLs
              <img key={src} src={src} alt={product.name} className="h-full w-full shrink-0 snap-center object-cover" />
            ))}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-[#10231C]">
            <ShoppingBag size={150} strokeWidth={0.9} aria-hidden="true" />
          </div>
        )}
        {photos.length > 1 && (
          <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-1.5" aria-hidden="true">
            {photos.map((src, i) => (
              <span key={src} className={`h-1.5 rounded-full transition-all ${i === photo ? "w-4 bg-accent" : "w-1.5 bg-white/70"}`} />
            ))}
          </div>
        )}
        {off > 0 && (
          <span className="absolute bottom-4 right-4 rounded-full bg-accent px-3 py-1.5 text-[13px] font-bold text-night">−{off}%</span>
        )}
        <div className="absolute inset-x-4 top-4 flex gap-2">
          <button
            type="button"
            onClick={() => (window.history.length > 1 ? router.back() : router.push("/"))}
            aria-label="Back"
            className="flex h-11 w-11 items-center justify-center rounded-[14px] bg-white text-night"
          >
            <ArrowLeft size={18} strokeWidth={2.2} />
          </button>
          <span className="flex-1" />
          <ThemeToggle className="!bg-white !text-night" />
          <button
            type="button"
            onClick={() => toggle(product.id)}
            aria-label={favorite ? "Remove from saved" : "Save item"}
            aria-pressed={favorite}
            className="flex h-11 w-11 items-center justify-center rounded-[14px] bg-white transition-transform active:scale-90"
          >
            <Heart size={18} strokeWidth={2} className={favorite ? "fill-accent text-accent" : "text-night"} />
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-4 px-4 pb-40 pt-[18px]">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-ink">{product.name}</h1>
          <span className="flex items-baseline gap-2.5">
            <span className={`text-[26px] font-semibold ${off > 0 ? "text-sale" : "text-ink"}`}>{formatNaira(minor(product.priceMinor))}</span>
            {off > 0 && product.compareAtPriceMinor != null && (
              <span className="text-[15px] text-muted line-through">{formatNaira(minor(product.compareAtPriceMinor))}</span>
            )}
          </span>
        </div>

        <Link href={`/vendors/${product.vendorId}`} className="flex items-center gap-3 rounded-xl bg-card p-2.5 text-ink">
          <span className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-xl bg-tile1 text-[#10231C]">
            {vendor?.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- external, vendor-supplied URL
              <img src={vendor.logoUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <ShoppingBasket size={22} strokeWidth={1.8} aria-hidden="true" />
            )}
          </span>
          <span className="flex flex-1 flex-col gap-0.5">
            <span className="font-bold">{product.vendorName}</span>
            <span className="text-xs text-muted">
              {vendor?.ratingAverage != null ? `★ ${vendor.ratingAverage.toFixed(1)}` : "New"}
              {product.avgDeliveryMinutes != null && ` · ${product.avgDeliveryMinutes} min`}
              {vendor && ` · ${vendor.pickupLandmark}`}
              {!product.vendorIsOpen && " · Closed"}
            </span>
          </span>
          <ChevronRight size={16} strokeWidth={2.2} aria-hidden="true" />
        </Link>

        {product.description && (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-bold text-ink">About this item</span>
            <p className="text-sm leading-relaxed text-muted">{product.description}</p>
          </div>
        )}

        <div className="flex gap-2">
          <Tile label="Delivery" value={product.avgDeliveryMinutes != null ? `${product.avgDeliveryMinutes} min` : "Same day"} />
          <Tile label="In stock" value={soldOut ? "Sold out" : `${product.stock} left`} />
          <Tile label="Problem?" value="Report after delivery" />
        </div>

        {pairs.length > 0 && (
          <div className="flex flex-col gap-2.5">
            <span className="text-sm font-bold text-ink">Goes well with</span>
            <div className="flex gap-2.5">
              {pairs.map((p) => {
                const on = picked.has(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => togglePair(p.id)}
                    aria-pressed={on}
                    aria-label={`${on ? "Remove" : "Add"} ${p.name}`}
                    className={`flex min-w-0 flex-1 flex-col items-start gap-1.5 rounded-2xl bg-card p-2.5 text-left text-ink transition-shadow ${
                      on ? "shadow-[inset_0_0_0_2px_#FF5A19]" : "shadow-[inset_0_0_0_2px_transparent]"
                    }`}
                  >
                    <span className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-xl bg-raised">
                      {p.images[0] ? (
                        // eslint-disable-next-line @next/next/no-img-element -- external, vendor-supplied URLs
                        <img src={p.images[0]} alt="" className="h-full w-full object-cover" />
                      ) : null}
                    </span>
                    <span className="w-full truncate text-xs font-bold">{p.name}</span>
                    <span className="text-xs">{on ? "Added ✓" : `+ ${formatNaira(minor(p.priceMinor))}`}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 mx-auto flex max-w-lg gap-2.5 bg-surface px-4 pb-4 pt-3 shadow-[0_-1px_0_rgb(var(--c-line))]">
        <span className="flex h-[58px] items-center rounded-xl bg-card">
          <button
            type="button"
            onClick={() => setQty((q) => Math.max(1, q - 1))}
            aria-label="One less"
            className="flex h-[58px] w-11 items-center justify-center text-[22px] font-bold text-ink"
          >
            −
          </button>
          <span key={qty} className="min-w-5 animate-bump text-center text-[17px] font-bold text-ink">
            {qty}
          </span>
          <button
            type="button"
            onClick={() => setQty((q) => Math.min(maxQty, q + 1))}
            disabled={qty >= maxQty}
            aria-label="One more"
            className="flex h-[58px] w-11 items-center justify-center text-[22px] font-bold text-ink disabled:opacity-40"
          >
            +
          </button>
        </span>
        <button
          type="button"
          onClick={handleAddToBag}
          disabled={soldOut}
          className="flex h-[58px] flex-1 items-center justify-between rounded-xl bg-accent px-[18px] text-night transition-transform active:scale-[0.98] disabled:opacity-50"
        >
          <span className="text-[15px] font-bold">{soldOut ? "Sold out" : "Add to bag"}</span>
          {!soldOut && <span className="text-base font-semibold">{formatNaira(minor(total))}</span>}
        </button>
      </div>

      {conflict && (
        <div className="fixed inset-0 z-40 flex animate-fade-in items-end justify-center bg-black/40 sm:items-center">
          <div className="w-full max-w-lg rounded-t-2xl bg-card p-5 sm:rounded-2xl">
            <p className="font-semibold text-ink">Start a new bag?</p>
            <p className="mt-1 text-sm text-muted">
              Your bag has items from {cart.vendor?.businessName}. CloseBuy bags are one shop at a time — adding from{" "}
              {product.vendorName} will clear it.
            </p>
            <div className="mt-4 flex gap-2">
              <Button onClick={confirmReplace}>Clear bag and add</Button>
              <Button variant="secondary" onClick={() => setConflict(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex flex-1 flex-col gap-0.5 rounded-[14px] bg-card p-3">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-[13px] font-bold leading-tight text-ink">{value}</span>
    </span>
  );
}
