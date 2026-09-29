import { formatNaira, minor } from "@closebuy/types";
import type { ProductDto } from "@closebuy/types";

/**
 * The vendor storefront's "Quick Buy" row (screens-navigation.md has no
 * entry for this yet — matches the DoorDash reference's "Featured Items"
 * pattern: a horizontal scroller of compact, image-forward cards, distinct
 * from ProductCard's wide list-row layout used everywhere else on this
 * page). Curated per vendor (Product.isQuickBuy), not computed.
 */
export function QuickBuyCard({ product, onAdd }: { product: ProductDto; onAdd: () => void }) {
  const outOfStock = product.stock === 0;

  return (
    <button
      type="button"
      onClick={onAdd}
      disabled={outOfStock}
      className="flex w-28 shrink-0 flex-col gap-1 text-left disabled:opacity-50"
    >
      <div className="relative h-28 w-28 overflow-hidden rounded-2xl bg-surface shadow-sm">
        {product.images[0] ? (
          // eslint-disable-next-line @next/next/no-img-element -- external, vendor-supplied URLs
          <img src={product.images[0]} alt="" className="h-full w-full object-contain" loading="lazy" />
        ) : null}
        {!outOfStock && (
          <span className="absolute bottom-1.5 right-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-accent text-base font-bold leading-none text-white shadow">
            +
          </span>
        )}
      </div>
      <p className="truncate text-xs font-semibold text-ink">{product.name}</p>
      <p className={`text-xs font-bold ${outOfStock ? "text-danger" : "text-accent"}`}>
        {outOfStock ? "Out of stock" : formatNaira(minor(product.priceMinor))}
      </p>
    </button>
  );
}
