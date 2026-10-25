"use client";

import Link from "next/link";
import { Plus, ShoppingBag } from "lucide-react";
import { formatNaira, minor } from "@closebuy/types";
import type { ProductListingDto } from "@closebuy/types";
import { discountOff, tileFor } from "@/components/DealCard";

/** A product as a search/favourites result line: photo, name, shop, price (with the was-price when it's really on sale), one-tap add. */
export function ProductRow({ product, onAdd }: { product: ProductListingDto; onAdd: (p: ProductListingDto) => void }) {
  const off = discountOff(product);
  const soldOut = product.stock === 0;
  return (
    <div className="flex items-center gap-3 rounded-[14px] bg-card p-2.5">
      <Link href={`/products/${product.id}`} className="flex min-w-0 flex-1 items-center gap-3">
        <span className={`flex h-[68px] w-[68px] shrink-0 items-center justify-center overflow-hidden rounded-[14px] ${tileFor(product.id)}`}>
          {product.images[0] ? (
            // eslint-disable-next-line @next/next/no-img-element -- external, vendor-supplied URLs
            <img src={product.images[0]} alt="" className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <ShoppingBag size={32} strokeWidth={1.4} className="text-[#10231C]" aria-hidden="true" />
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <span className="truncate text-[15px] font-bold text-ink">{product.name}</span>
          <span className="truncate text-xs text-muted">
            {product.vendorName}
            {product.avgDeliveryMinutes != null && ` · ${product.avgDeliveryMinutes} min`}
            {!product.vendorIsOpen && " · Closed"}
          </span>
          <span className="flex items-baseline gap-1.5">
            <span className={`text-[15px] font-semibold ${off > 0 ? "text-sale" : "text-ink"}`}>{formatNaira(minor(product.priceMinor))}</span>
            {off > 0 && product.compareAtPriceMinor != null && (
              <span className="text-xs text-muted line-through">{formatNaira(minor(product.compareAtPriceMinor))}</span>
            )}
            {soldOut && <span className="text-xs font-medium text-danger">Sold out</span>}
          </span>
        </span>
      </Link>
      <button
        type="button"
        onClick={() => onAdd(product)}
        disabled={soldOut}
        aria-label={`Add ${product.name}`}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-[#10231C] transition-transform active:scale-90 disabled:opacity-40"
      >
        <Plus size={16} strokeWidth={2.6} />
      </button>
    </div>
  );
}
