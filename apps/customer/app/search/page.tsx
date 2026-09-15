"use client";

import { useEffect, useState } from "react";
import { Input } from "@closebuy/ui";
import { ApiClientError } from "@closebuy/api-client";
import type { CategoryDto, VendorDto } from "@closebuy/types";
import { catalogApi } from "@/lib/api";
import { VendorCard } from "@/components/VendorCard";
import { CategoryChips } from "@/components/CategoryChips";
import { CartBar } from "@/components/CartBar";

/**
 * US-C-03. Vendor-name search + category filter — real, against
 * GET /vendors. Not built: product-level search (the API only ever
 * searches vendors, so "results list mixing vendors and products",
 * screens-navigation.md §1.2, is scoped down to vendors only here —
 * a real gap worth flagging, not a silent one).
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
        placeholder="Search vendors…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />

      <CategoryChips categories={categories} active={activeCategory} onSelect={setActiveCategory} />

      {error && <p className="text-sm text-danger">{error}</p>}

      {!hasSearched ? (
        <p className="py-8 text-center text-sm text-muted">Search by vendor name, or pick a category above.</p>
      ) : vendors === null ? (
        <p className="py-8 text-center text-sm text-muted">Searching…</p>
      ) : vendors.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">No vendors match “{query || "that category"}”.</p>
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
