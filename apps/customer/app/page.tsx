"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuthSession } from "@closebuy/ui";
import { ApiClientError } from "@closebuy/api-client";
import type { CategoryDto, VendorDto } from "@closebuy/types";
import { catalogApi } from "@/lib/api";
import { VendorCard } from "@/components/VendorCard";
import { CategoryChips } from "@/components/CategoryChips";
import { CartBar } from "@/components/CartBar";

// No auth gate here — browsing never requires an account (brief §3.1b).
// The only place identity comes up at all is checkout, and even then it's
// optional (brief §3.1b, US-C-06).
export default function HomePage() {
  const { session, isLoaded } = useAuthSession();

  const [categories, setCategories] = useState<CategoryDto[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | undefined>(undefined);
  const [vendors, setVendors] = useState<VendorDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    catalogApi.listCategories().then((res) => setCategories(res.categories)).catch(() => {});
  }, []);

  useEffect(() => {
    setVendors(null);
    catalogApi
      .searchVendors({ category: activeCategory, limit: 30 })
      .then((res) => setVendors(res.vendors))
      .catch((err) => setError(err instanceof ApiClientError ? err.message : "Couldn't load vendors."));
  }, [activeCategory]);

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Address/fulfilment bar — screens-navigation.md §1.1. Launch is
          Riverpark-only (brief §2a), so this is a static label rather than
          a live address switcher; that needs saved addresses + a maps
          integration, neither built yet (a deliberate M1 simplification,
          not a silent gap). */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted">Delivering in</p>
          <p className="text-base font-semibold text-ink">Riverpark</p>
        </div>
        {isLoaded && !session && (
          <Link href="/login" className="text-sm font-medium text-primary underline">
            Sign in
          </Link>
        )}
      </div>

      <Link
        href="/search"
        className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-muted shadow-sm"
      >
        Search vendors or products
      </Link>

      <CategoryChips categories={categories} active={activeCategory} onSelect={setActiveCategory} />

      {error && <p className="text-sm text-danger">{error}</p>}

      {vendors === null ? (
        <p className="py-8 text-center text-sm text-muted">Loading vendors…</p>
      ) : vendors.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">
          {activeCategory ? "No vendors in this category yet." : "No vendors here yet — check back soon."}
        </p>
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
