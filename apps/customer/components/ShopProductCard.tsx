"use client";

import { Heart, Plus, ShoppingBag } from "lucide-react";
import { formatNaira, minor } from "@closebuy/types";
import type { ProductDto } from "@closebuy/types";
import { discountOff, tileFor } from "@/components/DealCard";
import { useFavorites } from "@/lib/favorites";

/** A product in a shop's 2-up grid: photo with sale badge + heart, name (opens the detail sheet), price, and add / stepper. */
export function ShopProductCard({
  product,
  quantity,
  onAdd,
  onIncrement,
  onDecrement,
  onOpenDetail,
}: {
  product: ProductDto;
  quantity: number;
  onAdd: () => void;
  onIncrement: () => void;
  onDecrement: () => void;
  onOpenDetail: () => void;
}) {
  const { isFavorite, toggle } = useFavorites();
  const off = discountOff(product);
  const favorite = isFavorite(product.id);
  const soldOut = product.stock === 0;

  return (
    <div className="flex flex-col gap-2 rounded-[14px] bg-card p-1.5 shadow-[0_0_0_1px_rgb(var(--c-line))]">
      <div className={`relative flex h-[118px] items-center justify-center overflow-hidden rounded-[10px] ${tileFor(product.id)}`}>
        {product.images[0] ? (
          // eslint-disable-next-line @next/next/no-img-element -- external, vendor-supplied URLs
          <img src={product.images[0]} alt="" className={`h-full w-full object-cover ${soldOut ? "opacity-50" : ""}`} loading="lazy" />
        ) : (
          <ShoppingBag size={50} strokeWidth={1.2} className="text-[#0E1F19]" aria-hidden="true" />
        )}
        {soldOut ? (
          <span className="absolute left-1.5 top-1.5 rounded-md bg-[#0E1F19] px-1.5 py-0.5 font-mono text-[10px] text-[#F3EEE9]">SOLD OUT</span>
        ) : off > 0 ? (
          <span className="absolute left-1.5 top-1.5 rounded-md bg-[#0E1F19] px-1.5 py-0.5 font-mono text-[10px] text-[#FF8A5C]">−{off}%</span>
        ) : product.isQuickBuy ? (
          <span className="absolute left-1.5 top-1.5 rounded-md bg-[#0E1F19] px-1.5 py-0.5 font-mono text-[10px] text-[#F3EEE9]">TOP</span>
        ) : null}
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
        <button
          type="button"
          onClick={onOpenDetail}
          className="line-clamp-2 text-left text-[13px] font-medium text-ink underline decoration-line underline-offset-[3px]"
        >
          {product.name}
        </button>
      </div>
      <div className="flex min-h-10 items-center justify-between pl-1">
        <span className="flex flex-col font-mono">
          <span className={`text-[13px] font-semibold ${off > 0 ? "text-sale" : "text-ink"}`}>{formatNaira(minor(product.priceMinor))}</span>
          {off > 0 && product.compareAtPriceMinor != null && (
            <span className="text-[10px] text-muted line-through">{formatNaira(minor(product.compareAtPriceMinor))}</span>
          )}
        </span>
        {quantity === 0 ? (
          <button
            type="button"
            onClick={onAdd}
            disabled={soldOut}
            aria-label={`Add ${product.name}`}
            className="flex h-9 w-11 items-center justify-center rounded-[9px] bg-accent text-[#0E1F19] transition-transform active:scale-90 disabled:opacity-40"
          >
            <Plus size={16} strokeWidth={2.2} />
          </button>
        ) : (
          <span className="flex h-9 items-center rounded-[9px] font-mono shadow-[inset_0_0_0_1px_rgb(var(--c-line))]">
            <button type="button" onClick={onDecrement} aria-label={`Remove one ${product.name}`} className="flex h-11 w-7 items-center justify-center text-[15px] text-ink">
              −
            </button>
            <span key={quantity} className="min-w-3.5 animate-bump text-center text-[13px] font-semibold text-ink">
              {quantity}
            </span>
            <button
              type="button"
              onClick={onIncrement}
              disabled={quantity >= product.stock}
              aria-label={`Add one more ${product.name}`}
              className="flex h-11 w-7 items-center justify-center text-[15px] text-ink disabled:opacity-40"
            >
              +
            </button>
          </span>
        )}
      </div>
    </div>
  );
}
