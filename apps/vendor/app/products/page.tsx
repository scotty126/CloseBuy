"use client";

import { useEffect, useState } from "react";
import { Input } from "@closebuy/ui";
import { ApiClientError } from "@closebuy/api-client";
import { formatNaira, minor } from "@closebuy/types";
import type { ProductDto, CategoryDto, OwnVendorProfileDto } from "@closebuy/types";
import { catalogApi } from "@/lib/api";
import { VendorGate } from "@/components/VendorGate";
import { PageHeader } from "@/components/PageHeader";

/** screens-navigation.md §2.2 — US-V-03/04. Deactivate, never delete (order history references it). */
export default function ProductsPage() {
  return <VendorGate>{(vendor, refetch) => <ProductsManager vendor={vendor} refetch={refetch} />}</VendorGate>;
}

const LOW_STOCK = 10;

const field = "rounded-xl border-0 bg-card px-3 py-2.5 text-sm text-ink shadow-[inset_0_0_0_1px_rgb(var(--c-line))] outline-none focus:shadow-[inset_0_0_0_2px_#FF5A19]";

function ProductsManager({ vendor, refetch }: { vendor: OwnVendorProfileDto; refetch: () => void }) {
  const [products, setProducts] = useState<ProductDto[] | null>(null);
  const [categories, setCategories] = useState<CategoryDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ProductDto | "new" | null>(null);

  function load() {
    catalogApi
      .getOwnVendorProducts()
      .then((res) => setProducts(res.products))
      .catch((err) => setError(err instanceof ApiClientError ? err.message : "Couldn't load products."));
  }

  useEffect(() => {
    load();
    catalogApi.listCategories().then((res) => setCategories(res.categories)).catch(() => {});
  }, []);

  async function handleToggleActive(product: ProductDto) {
    setError(null);
    try {
      if (product.isActive) await catalogApi.deactivateProduct(product.id);
      else await catalogApi.updateProduct(product.id, { isActive: true });
      load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Couldn't update this product.");
    }
  }

  if (editing) {
    return (
      <ProductForm
        categories={categories}
        product={editing === "new" ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          load();
        }}
      />
    );
  }

  const lowCount = products?.filter((p) => p.isActive && p.stock <= LOW_STOCK).length ?? 0;

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Products"
        subtitle={products ? `${products.length} items · ${lowCount} need attention` : undefined}
        vendor={vendor}
        onVendorChanged={refetch}
      />

      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => setEditing("new")}
          className="flex h-11 items-center justify-center self-start rounded-xl bg-accent px-5 text-sm font-semibold text-night transition-transform active:scale-[0.98]"
        >
          + Add product
        </button>

        {error && <p className="text-sm text-danger">{error}</p>}

        {products === null ? (
          <p className="py-8 text-center text-sm text-muted">Loading…</p>
        ) : products.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">No products yet — add your first one.</p>
        ) : (
          <div className="grid grid-cols-1 gap-2.5 xl:grid-cols-2">
            {products.map((product) => {
              const low = product.isActive && product.stock <= LOW_STOCK;
              const onSale = product.compareAtPriceMinor != null && product.compareAtPriceMinor > product.priceMinor;
              return (
                <div key={product.id} className={`flex items-center gap-3 rounded-[14px] bg-card p-3 shadow-[inset_0_0_0_1px_rgb(var(--c-line))] ${product.isActive ? "" : "opacity-70"}`}>
                  <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-raised">
                    {product.images[0] && (
                      // eslint-disable-next-line @next/next/no-img-element -- vendor-supplied URLs, no fixed domain to allowlist
                      <img src={product.images[0]} alt="" className="h-full w-full object-cover" loading="lazy" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{product.name}</p>
                    <p className="flex items-baseline gap-1.5 font-mono text-xs">
                      <span className={onSale ? "text-sale" : "text-ink"}>{formatNaira(minor(product.priceMinor))}</span>
                      {onSale && <span className="text-[10px] text-muted line-through">{formatNaira(minor(product.compareAtPriceMinor!))}</span>}
                    </p>
                    <p className="mt-0.5 flex items-center gap-1.5 font-mono text-[11px]">
                      <span className={low ? "rounded bg-accent px-1.5 py-px text-night" : "text-muted"}>
                        {product.stock === 0 ? "Sold out" : `${product.stock} in stock`}
                      </span>
                      {!product.isActive && <span className="text-muted">· inactive</span>}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end">
                    <button type="button" onClick={() => setEditing(product)} className="flex h-9 items-center px-2 text-xs font-medium text-ink underline underline-offset-2">
                      Edit
                    </button>
                    <button type="button" onClick={() => handleToggleActive(product)} className="flex h-9 items-center px-2 text-xs text-muted underline underline-offset-2">
                      {product.isActive ? "Deactivate" : "Reactivate"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function ProductForm({
  categories,
  product,
  onClose,
  onSaved,
}: {
  categories: CategoryDto[];
  product: ProductDto | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(product?.name ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? categories[0]?.id ?? "");
  const [priceNaira, setPriceNaira] = useState(product ? String(product.priceMinor / 100) : "");
  const [stock, setStock] = useState(product ? String(product.stock) : "0");
  // The struck-through "was" price. Empty = not on sale. Display only — customers are always charged the price above.
  const [wasNaira, setWasNaira] = useState(product?.compareAtPriceMinor != null ? String(product.compareAtPriceMinor / 100) : "");
  const [imagesText, setImagesText] = useState(product?.images.join("\n") ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const images = imagesText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    const priceMinor = Math.round(Number(priceNaira) * 100);

    if (!Number.isFinite(priceMinor) || priceMinor < 0) {
      setError("Enter a valid price.");
      return;
    }
    const compareAtPriceMinor = wasNaira.trim() === "" ? null : Math.round(Number(wasNaira) * 100);
    if (compareAtPriceMinor !== null && (!Number.isFinite(compareAtPriceMinor) || compareAtPriceMinor <= priceMinor)) {
      setError("The original price has to be higher than the selling price — or leave it empty if this isn't on sale.");
      return;
    }
    if (images.length === 0) {
      setError("Add at least one image URL.");
      return;
    }

    setIsSaving(true);
    try {
      const input = {
        name,
        description: description.trim() || undefined,
        categoryId,
        priceMinor,
        images,
        stock: Number(stock),
        compareAtPriceMinor,
      };
      if (product) await catalogApi.updateProduct(product.id, input);
      else await catalogApi.createProduct(input);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Couldn't save this product.");
      setIsSaving(false);
    }
  }

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-ink">{product ? "Edit product" : "Add product"}</h1>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded-[14px] bg-card p-4 shadow-[inset_0_0_0_1px_rgb(var(--c-line))]">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required />
        <Input label="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-ink">Category</label>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            required
            className={field}
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <Input label="Price (₦)" inputMode="decimal" value={priceNaira} onChange={(e) => setPriceNaira(e.target.value)} required />
        <Input label="Original price (₦) — optional, shows as a sale" inputMode="decimal" value={wasNaira} onChange={(e) => setWasNaira(e.target.value)} placeholder="e.g. 9500" />
        <Input label="Stock" inputMode="numeric" value={stock} onChange={(e) => setStock(e.target.value)} required />

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-ink">Image URLs (one per line)</label>
          <p className="text-xs text-muted">No image upload yet (R2 isn&apos;t configured) — paste hosted URLs directly.</p>
          <textarea
            value={imagesText}
            onChange={(e) => setImagesText(e.target.value)}
            rows={3}
            placeholder="https://…"
            className={field}
          />
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="flex gap-2">
          <button type="submit" disabled={isSaving} className="flex h-11 flex-1 items-center justify-center rounded-xl bg-accent text-sm font-semibold text-night disabled:opacity-60">
            {isSaving ? "Saving…" : "Save"}
          </button>
          <button type="button" onClick={onClose} className="flex h-11 flex-1 items-center justify-center rounded-xl bg-card text-sm font-semibold text-ink shadow-[inset_0_0_0_1px_rgb(var(--c-line))]">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
