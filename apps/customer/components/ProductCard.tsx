import { formatNaira, minor } from "@closebuy/types";
import type { ProductDto } from "@closebuy/types";

export function ProductCard({
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
  const outOfStock = product.stock === 0;

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">
      <button
        type="button"
        onClick={onOpenDetail}
        aria-label={`View ${product.name}`}
        className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-surface"
      >
        {product.images[0] ? (
          // eslint-disable-next-line @next/next/no-img-element -- external, vendor-supplied URLs
          <img src={product.images[0]} alt="" className="h-full w-full object-contain" loading="lazy" />
        ) : null}
      </button>
      <button type="button" onClick={onOpenDetail} className="min-w-0 flex-1 text-left">
        <p className="truncate font-semibold text-ink">{product.name}</p>
        <p className="text-sm font-bold text-accent">{formatNaira(minor(product.priceMinor))}</p>
        {outOfStock ? (
          <p className="text-xs font-medium text-danger">Out of stock</p>
        ) : (
          <p className="flex items-center gap-1 text-xs font-medium text-success">
            <span className="h-1.5 w-1.5 rounded-full bg-success" /> Available
          </p>
        )}
      </button>
      {quantity > 0 ? (
        <div className="flex shrink-0 items-center gap-2 rounded-full bg-surface px-1 py-1">
          <button
            type="button"
            onClick={onDecrement}
            aria-label={`Remove one ${product.name}`}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-ink shadow-sm"
          >
            −
          </button>
          <span className="w-4 text-center text-sm font-bold text-ink">{quantity}</span>
          <button
            type="button"
            onClick={onIncrement}
            disabled={quantity >= product.stock}
            aria-label={`Add one more ${product.name}`}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-white shadow-sm disabled:opacity-40"
          >
            +
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onAdd}
          disabled={outOfStock}
          aria-label={`Add ${product.name}`}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-xl font-bold leading-none text-white shadow-sm disabled:opacity-40"
        >
          +
        </button>
      )}
    </div>
  );
}
