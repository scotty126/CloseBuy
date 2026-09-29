"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuthSession } from "@closebuy/ui";
import { ApiClientError } from "@closebuy/api-client";
import { MapPin, ChevronDown, Search, Store } from "lucide-react";
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
      <div className="flex items-center justify-between gap-2">
        {/* Static label, not a live address switcher — launch is
            Riverpark-only (brief §2a); a real switcher needs saved
            addresses + a maps integration, neither built yet (a
            deliberate M1 simplification, not a silent gap). Styled as a
            defined pill, not bare text, so it reads as a real control. */}
        <div className="flex items-center gap-1.5 rounded-full border border-gray-200 bg-white py-1.5 pl-1.5 pr-3 shadow-sm">
          {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset, not vendor-supplied */}
          <img src="/logo-icon.png" alt="" className="h-7 w-7 shrink-0 rounded-full" />
          <MapPin size={15} className="shrink-0 text-primary" />
          <div className="leading-tight">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted">Delivering in</p>
            <p className="flex items-center gap-0.5 text-sm font-bold text-ink">
              Riverpark <ChevronDown size={14} className="text-muted" />
            </p>
          </div>
        </div>
        {isLoaded && !session && (
          <Link
            href="/login"
            className="shrink-0 rounded-full bg-primary px-3.5 py-2 text-xs font-semibold text-white shadow-sm"
          >
            Sign in
          </Link>
        )}
      </div>

      <Link
        href="/search"
        className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3.5 text-sm font-medium text-muted shadow-sm active:bg-surface"
      >
        <Search size={19} className="shrink-0 text-muted" />
        Search vendors or products
      </Link>

      <CategoryChips categories={categories} active={activeCategory} onSelect={setActiveCategory} />

      {error && <p className="text-sm text-danger">{error}</p>}

      {vendors === null ? (
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
          <p className="text-sm font-medium text-ink">
            {activeCategory ? "No vendors in this category yet" : "No vendors here yet"}
          </p>
          <p className="text-xs text-muted">Check back soon, or try another category.</p>
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
