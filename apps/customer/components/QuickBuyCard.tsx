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
      <div className="h-28 w-28 overflow-hidden rounded-xl bg-surface">
        {product.images[0] ? (
          // eslint-disable-next-line @next/next/no-img-element -- external, vendor-supplied URLs
          <img src={product.images[0]} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : null}
      </div>
      <p className="truncate text-xs font-medium text-ink">{product.name}</p>
      <p className="text-xs text-muted">{outOfStock ? "Out of stock" : formatNaira(minor(product.priceMinor))}</p>
    </button>
  );
}
