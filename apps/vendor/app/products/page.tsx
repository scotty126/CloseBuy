"use client";

import { useEffect, useState } from "react";
import { Button, Input } from "@closebuy/ui";
import { ApiClientError } from "@closebuy/api-client";
import { formatNaira, minor } from "@closebuy/types";
import type { ProductDto, CategoryDto } from "@closebuy/types";
import { catalogApi } from "@/lib/api";
import { VendorGate } from "@/components/VendorGate";

/** screens-navigation.md §2.2 — US-V-03/04. Deactivate, never delete (order history references it). */
export default function ProductsPage() {
  return <VendorGate>{() => <ProductsManager />}</VendorGate>;
}

function ProductsManager() {
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

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-ink">Products</h1>
        <Button onClick={() => setEditing("new")}>Add product</Button>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      {products === null ? (
        <p className="py-8 text-center text-sm text-muted">Loading…</p>
      ) : products.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">No products yet — add your first one.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {products.map((product) => (
            <div key={product.id} className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-3">
              <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-surface">
                {product.images[0] && (
                  // eslint-disable-next-line @next/next/no-img-element -- vendor-supplied URLs, no fixed domain to allowlist
                  <img src={product.images[0]} alt="" className="h-full w-full object-cover" loading="lazy" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-ink">{product.name}</p>
                <p className="text-sm text-muted">
                  {formatNaira(minor(product.priceMinor))} · Stock: {product.stock}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  product.isActive ? "bg-success/10 text-success" : "bg-muted/10 text-muted"
                }`}
              >
                {product.isActive ? "Active" : "Inactive"}
              </span>
              <button type="button" onClick={() => setEditing(product)} className="shrink-0 text-xs text-primary underline">
                Edit
              </button>
              <button type="button" onClick={() => handleToggleActive(product)} className="shrink-0 text-xs text-muted underline">
                {product.isActive ? "Deactivate" : "Reactivate"}
              </button>
            </div>
          ))}
        </div>
      )}
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
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-lg font-bold text-ink">{product ? "Edit product" : "Add product"}</h1>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required />
        <Input label="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-ink">Category</label>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            required
            className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <Input label="Price (₦)" inputMode="decimal" value={priceNaira} onChange={(e) => setPriceNaira(e.target.value)} required />
        <Input label="Stock" inputMode="numeric" value={stock} onChange={(e) => setStock(e.target.value)} required />

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-ink">Image URLs (one per line)</label>
          <p className="text-xs text-muted">No image upload yet (R2 isn&apos;t configured) — paste hosted URLs directly.</p>
          <textarea
            value={imagesText}
            onChange={(e) => setImagesText(e.target.value)}
            rows={3}
            placeholder="https://…"
            className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
          />
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="flex gap-2">
          <Button type="submit" disabled={isSaving}>
            {isSaving ? "Saving…" : "Save"}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
