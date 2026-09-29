"use client";

import { useEffect, useState } from "react";
import { Input } from "@closebuy/ui";
import { ApiClientError } from "@closebuy/api-client";
import { Search as SearchIcon, Store } from "lucide-react";
import type { CategoryDto, VendorDto } from "@closebuy/types";
import { catalogApi } from "@/lib/api";
import { VendorCard } from "@/components/VendorCard";
import { CategoryChips } from "@/components/CategoryChips";
import { CartBar } from "@/components/CartBar";

/**
 * US-C-03. Vendor-name and product-name search (a vendor matches if its
 * own name matches, or if any of its active products' names do —
 * catalog/service.ts's searchVendors) plus category filter — the result
 * is still one list of vendors, not the two-lists-mixed-together UI
 * screens-navigation.md §1.2 sketched (a real, flagged scope-down, not a
 * silent one), but the actual "find an item without knowing the vendor"
 * need is met either way.
 */
export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [categories, setCategories] = useState<CategoryDto[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | undefined>(undefined);
  const [vendors, setVendors] = useState<VendorDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    catalogApi.listCategories().then((res) => setCategories(res.categories)).catch(() => {});
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed && !activeCategory) {
      setVendors(null);
      return;
    }
    const handle = setTimeout(() => {
      catalogApi
        .searchVendors({ q: trimmed || undefined, category: activeCategory, limit: 30 })
        .then((res) => setVendors(res.vendors))
        .catch((err) => setError(err instanceof ApiClientError ? err.message : "Search failed."));
    }, 300); // debounce — avoid a request per keystroke
    return () => clearTimeout(handle);
  }, [query, activeCategory]);

  const hasSearched = query.trim().length > 0 || activeCategory !== undefined;

  return (
    <div className="flex flex-col gap-4 p-4">
      <Input
        placeholder="Search vendors or products…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />

      <CategoryChips categories={categories} active={activeCategory} onSelect={setActiveCategory} />

      {error && <p className="text-sm text-danger">{error}</p>}

      {!hasSearched ? (
        <div className="flex flex-col items-center gap-2 py-14 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface text-muted">
            <SearchIcon size={22} />
          </span>
          <p className="text-sm font-medium text-ink">Search by vendor or product name</p>
          <p className="text-xs text-muted">Or pick a category above.</p>
        </div>
      ) : vendors === null ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-52 animate-pulse rounded-2xl bg-surface" />
          ))}
        </div>
      ) : vendors.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-14 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface text-muted">
            <Store size={22} />
          </span>
          <p className="text-sm font-medium text-ink">No vendors match &ldquo;{query || "that category"}&rdquo;</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {vendors.map((vendor) => (
            <VendorCard key={vendor.id} vendor={vendor} />
          ))}
        </div>
      )}

      <CartBar />
    </div>
  );
}
