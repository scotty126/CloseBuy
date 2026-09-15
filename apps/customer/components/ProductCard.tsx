import { formatNaira, minor } from "@closebuy/types";
import type { ProductDto } from "@closebuy/types";

export function ProductCard({
  product,
  quantity,
  onAdd,
  onIncrement,
  onDecrement,
}: {
  product: ProductDto;
  quantity: number;
  onAdd: () => void;
  onIncrement: () => void;
  onDecrement: () => void;
}) {
  const outOfStock = product.stock === 0;

  return (
    <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-3">
      <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-surface">
        {product.images[0] ? (
          // eslint-disable-next-line @next/next/no-img-element -- external, vendor-supplied URLs
          <img src={product.images[0]} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-ink">{product.name}</p>
        <p className="text-sm text-muted">{formatNaira(minor(product.priceMinor))}</p>
        {outOfStock && <p className="text-xs text-danger">Out of stock</p>}
      </div>
      {quantity > 0 ? (
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onDecrement}
            aria-label={`Remove one ${product.name}`}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-surface text-ink"
          >
            −
          </button>
          <span className="w-4 text-center text-sm font-medium text-ink">{quantity}</span>
          <button
            type="button"
            onClick={onIncrement}
            disabled={quantity >= product.stock}
            aria-label={`Add one more ${product.name}`}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-white disabled:opacity-40"
          >
            +
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onAdd}
          disabled={outOfStock}
          className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
        >
          Add
        </button>
      )}
    </div>
  );
}
