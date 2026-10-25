"use client";

import Link from "next/link";
import { Check, Heart, Plus, ShoppingBag } from "lucide-react";
import { formatNaira, minor } from "@closebuy/types";
import type { ProductListingDto } from "@closebuy/types";
import { useCart } from "@/lib/cart";
import { useFavorites } from "@/lib/favorites";

export function discountOff(p: Pick<ProductListingDto, "priceMinor" | "compareAtPriceMinor">): number {
  if (p.compareAtPriceMinor == null || p.compareAtPriceMinor <= p.priceMinor) return 0;
  return Math.round(((p.compareAtPriceMinor - p.priceMinor) / p.compareAtPriceMinor) * 100);
}

const TILES = ["bg-tile0", "bg-tile1", "bg-tile2", "bg-tile3", "bg-tile4", "bg-tile5"] as const;
/** A stable colour per product, so a card without a photo always wears the same tile. */
export function tileFor(id: string): (typeof TILES)[number] {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return TILES[h % TILES.length]!;
}

/** Home's "Deals near you" tile, to the canvas's measurements: 152px wide, a 112px tile, mono prices, a 44×36 add button. */
export function DealCard({ product, onAdd }: { product: ProductListingDto; onAdd: (p: ProductListingDto) => void }) {
  const { cart } = useCart();
  const { isFavorite, toggle } = useFavorites();
  const off = discountOff(product);
  const favorite = isFavorite(product.id);
  const inBag = cart.items.some((i) => i.productId === product.id);
  const soldOut = product.stock === 0;

  return (
    <div className="flex w-[152px] shrink-0 flex-col gap-2 rounded-[14px] bg-card p-1.5 shadow-[0_0_0_1px_rgb(var(--c-line))] lg:w-auto">
      <div className={`relative flex h-28 items-center justify-center overflow-hidden rounded-[10px] ${tileFor(product.id)}`}>
        {product.images[0] ? (
          // eslint-disable-next-line @next/next/no-img-element -- external, vendor-supplied URLs
          <img src={product.images[0]} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <ShoppingBag size={48} strokeWidth={1.2} className="text-[#0E1F19]" aria-hidden="true" />
        )}
        {off > 0 && (
          <span className="absolute left-1.5 top-1.5 rounded-md bg-[#0E1F19] px-1.5 py-0.5 font-mono text-[10px] text-[#FF8A5C]">−{off}%</span>
        )}
        <button
          type="button"
          onClick={() => toggle(product.id)}
          aria-label={favorite ? `Remove ${product.name} from saved` : `Save ${product.name}`}
          aria-pressed={favorite}
          className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center transition-transform active:scale-90"
        >
          <Heart size={16} strokeWidth={1.8} className={`text-[#0E1F19] ${favorite ? "fill-accent" : "fill-transparent"}`} />
        </button>
      </div>
      <div className="flex flex-col gap-px px-1">
        <Link href={`/products/${product.id}`} className="truncate text-[13px] font-medium text-ink">
          {product.name}
        </Link>
        <span className="truncate text-[11px] text-muted">{product.vendorName}</span>
      </div>
      <div className="flex items-center justify-between pl-1">
        <span className="flex flex-col font-mono">
          <span className={`text-[13px] font-semibold ${off > 0 ? "text-sale" : "text-ink"}`}>{formatNaira(minor(product.priceMinor))}</span>
          {off > 0 && product.compareAtPriceMinor != null && (
            <span className="text-[10px] text-muted line-through">{formatNaira(minor(product.compareAtPriceMinor))}</span>
          )}
        </span>
        <button
          type="button"
          onClick={() => onAdd(product)}
          disabled={soldOut}
          aria-label={inBag ? `${product.name} added, tap to add another` : `Add ${product.name} to bag`}
          className={`flex h-9 w-11 items-center justify-center rounded-[9px] transition-colors disabled:opacity-40 ${inBag ? "bg-primary" : "bg-accent"}`}
        >
          {inBag ? <Check size={16} strokeWidth={2.2} className="text-[#F3EEE9]" /> : <Plus size={16} strokeWidth={2.2} className="text-[#0E1F19]" />}
        </button>
      </div>
    </div>
  );
}
