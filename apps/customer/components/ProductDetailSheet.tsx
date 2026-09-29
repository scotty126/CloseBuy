"use client";

import { X } from "lucide-react";
import { formatNaira, minor } from "@closebuy/types";
import type { ProductDto } from "@closebuy/types";

/**
 * The Foodys reference's item sheet, adapted: full image + name + price +
 * description + a quantity stepper. Deliberately no "YOUR ORDER"/packaging
 * section — Product has no modifiers in the data model (there's nothing to
 * disambiguate the base item from), and packaging/container choice was
 * explicitly scoped out (most CloseBuy vendors are supermarkets/pharmacies,
 * not restaurants — the concept doesn't obviously fit the catalogue).
 */
export function ProductDetailSheet({
  product,
  quantity,
  onAdd,
  onIncrement,
  onDecrement,
  onClose,
}: {
  product: ProductDto;
  quantity: number;
  onAdd: () => void;
  onIncrement: () => void;
  onDecrement: () => void;
  onClose: () => void;
}) {
  const outOfStock = product.stock === 0;

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/50 sm:items-center" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-white sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative h-56 w-full shrink-0 bg-surface">
          {product.images[0] ? (
            // eslint-disable-next-line @next/next/no-img-element -- external, vendor-supplied URLs
            <img src={product.images[0]} alt="" className="h-full w-full object-cover" />
          ) : null}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-col gap-2 overflow-y-auto p-4">
          <h2 className="text-xl font-bold text-ink">{product.name}</h2>
          <p className="text-lg font-bold text-accent">{formatNaira(minor(product.priceMinor))}</p>
          {outOfStock ? (
            <p className="text-sm font-medium text-danger">Out of stock</p>
          ) : (
            <p className="flex items-center gap-1.5 text-sm font-medium text-success">
              <span className="h-2 w-2 rounded-full bg-success" /> Available
            </p>
          )}
          {product.description && <p className="text-sm leading-relaxed text-ink">{product.description}</p>}
        </div>

        <div className="flex items-center gap-3 border-t border-gray-100 p-4">
          {quantity > 0 && (
            <div className="flex items-center gap-3 rounded-full bg-surface px-2 py-1.5">
              <button
                type="button"
                onClick={onDecrement}
                aria-label={`Remove one ${product.name}`}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-ink shadow-sm"
              >
                −
              </button>
              <span className="w-5 text-center text-base font-bold text-ink">{quantity}</span>
              <button
                type="button"
                onClick={onIncrement}
                disabled={quantity >= product.stock}
                aria-label={`Add one more ${product.name}`}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-white shadow-sm disabled:opacity-40"
              >
                +
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={quantity > 0 ? onClose : onAdd}
            disabled={outOfStock}
            className="flex-1 rounded-xl bg-accent py-3 text-sm font-bold text-white shadow-sm disabled:opacity-40"
          >
            {quantity > 0 ? "Done" : "Add to cart"}
          </button>
        </div>
      </div>
    </div>
  );
}
