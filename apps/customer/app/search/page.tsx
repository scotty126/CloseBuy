"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ApiClientError } from "@closebuy/api-client";
import { ArrowLeft, Clock, Search as SearchIcon, X } from "lucide-react";
import { ThemeToggle } from "@closebuy/ui";
import type { ProductListingDto } from "@closebuy/types";
import { catalogApi } from "@/lib/api";
import { ProductRow } from "@/components/ProductRow";
import { useQuickAdd } from "@/components/useQuickAdd";

const RECENT_KEY = "closebuy.recentSearches";
const MAX_RECENT = 6;
const UNDER_MINOR = 500_000; // ₦5,000

type FilterId = "sale" | "cheap" | "open";
const FILTERS: { id: FilterId; label: string }[] = [
  { id: "sale", label: "On sale" },
  { id: "cheap", label: "Under ₦5,000" },
  { id: "open", label: "Open now" },
];

function readRecent(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string").slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

function SearchScreen() {
  const params = useSearchParams();
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [filters, setFilters] = useState<Record<FilterId, boolean>>({ sale: params.get("sale") === "1", cheap: false, open: false });
  const [results, setResults] = useState<ProductListingDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const { add, dialog } = useQuickAdd();

  useEffect(() => setRecent(readRecent()), []);

  useEffect(() => {
    const trimmed = query.trim();
    setError(null);
    const handle = setTimeout(() => {
      catalogApi
        .searchProducts({
          q: trimmed || undefined,
          onSale: filters.sale,
          maxPriceMinor: filters.cheap ? UNDER_MINOR : undefined,
          openNow: filters.open,
          limit: 40,
        })
        .then((res) => setResults(res.products))
        .catch((err) => {
          setResults([]);
          setError(err instanceof ApiClientError ? err.message : "Search failed.");
        });
    }, 300); // debounce — avoid a request per keystroke
    return () => clearTimeout(handle);
  }, [query, filters]);

  // Remember a search once the person has actually settled on it (blur / enter), not per keystroke.
  const remember = useCallback(() => {
    const q = query.trim();
    if (!q) return;
    const next = [q, ...recent.filter((r) => r.toLowerCase() !== q.toLowerCase())].slice(0, MAX_RECENT);
    setRecent(next);
    try {
      window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      // Private mode — recents just won't persist.
    }
  }, [query, recent]);

  const hasQuery = query.trim().length > 0;
  const anyFilter = filters.sale || filters.cheap || filters.open;

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-3 px-4 pb-2.5 pt-[18px]">
        <div className="flex items-center gap-2">
          <Link href="/" aria-label="Back to home" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-card text-ink">
            <ArrowLeft size={18} strokeWidth={2.2} />
          </Link>
          <label className="flex h-12 flex-1 items-center gap-2 rounded-2xl bg-card px-3 shadow-[inset_0_0_0_2px_#FF5A19]">
            <SearchIcon size={18} strokeWidth={2} className="shrink-0 text-ink" aria-hidden="true" />
            <span className="sr-only">Search</span>
            <input
              type="search"
              placeholder="Search products or shops"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onBlur={remember}
              onKeyDown={(e) => e.key === "Enter" && remember()}
              className="min-w-0 flex-1 bg-transparent text-[15px] font-medium text-ink outline-none placeholder:text-muted"
            />
            {hasQuery && (
              <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="flex h-11 w-8 items-center justify-center text-muted">
                <X size={16} strokeWidth={2.4} />
              </button>
            )}
          </label>
          <ThemeToggle className="shrink-0" />
        </div>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]">
          {FILTERS.map((f) => {
            const on = filters[f.id];
            return (
              <button
                key={f.id}
                type="button"
                aria-pressed={on}
                onClick={() => setFilters((cur) => ({ ...cur, [f.id]: !cur[f.id] }))}
                className={`flex h-[38px] shrink-0 items-center rounded-full px-3.5 text-[13px] font-bold transition-colors ${
                  on ? "bg-primary text-white" : "bg-card text-ink"
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-3.5 px-4 pb-6 pt-1.5">
        {!hasQuery && !anyFilter && recent.length > 0 && (
          <div className="flex flex-col gap-2.5">
            <span className="text-[13px] font-bold text-muted">Recent</span>
            <div className="flex flex-wrap gap-2">
              {recent.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setQuery(r)}
                  className="flex h-10 items-center gap-1.5 rounded-full bg-card px-3.5 text-sm text-ink"
                >
                  <Clock size={14} strokeWidth={2} className="text-muted" aria-hidden="true" />
                  {r}
                </button>
              ))}
            </div>
          </div>
        )}

        {!hasQuery && !anyFilter && <span className="mt-2 text-[13px] font-bold text-muted">Available in Riverpark</span>}
        {(hasQuery || anyFilter) && results && results.length > 0 && (
          <span className="text-[13px] text-muted">
            {results.length} result{results.length === 1 ? "" : "s"}
            {hasQuery && (
              <>
                {" "}
                for <strong className="text-ink">“{query.trim()}”</strong>
              </>
            )}
          </span>
        )}

        {error && <p className="text-sm text-danger">{error}</p>}

        {results === null ? (
          <div className="flex flex-col gap-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-[14px] bg-raised" />
            ))}
          </div>
        ) : results.length === 0 && !error ? (
          <div className="flex flex-col items-center gap-3 px-5 py-10 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset */}
            <img src="/logo-mark.png" alt="" className="object-contain h-[60px] w-[63px] opacity-60" />
            <span className="text-lg font-semibold text-ink">Nothing nearby yet</span>
            <span className="text-sm leading-normal text-muted">No shop on your street sells that right now. Try another word or clear a filter.</span>
          </div>
        ) : (
          results.map((p) => <ProductRow key={p.id} product={p} onAdd={add} />)
        )}
      </div>

      {dialog}
    </div>
  );
}

// useSearchParams() needs a Suspense boundary for static prerendering.
export default function SearchPage() {
  return (
    <Suspense fallback={null}>
      <SearchScreen />
    </Suspense>
  );
}
