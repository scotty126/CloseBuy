"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiClientError } from "@closebuy/api-client";
import { Search, Store } from "lucide-react";
import type { CategoryDto, ProductListingDto, VendorDto } from "@closebuy/types";
import { catalogApi } from "@/lib/api";
import { AppHeader } from "@/components/AppHeader";
import { CategoryChips } from "@/components/CategoryChips";
import { DealCard, discountOff } from "@/components/DealCard";
import { VendorRow } from "@/components/VendorRow";
import { useQuickAdd } from "@/components/useQuickAdd";
import { MonoArrow } from "@/components/MonoArrow";
import { ONBOARDED_KEY } from "@/lib/onboarding";

const SLIDE_MS = 5000;
const MAX_SLIDES = 3;

// No auth gate here — browsing never requires an account (brief §3.1b).
// The only place identity comes up at all is checkout, and even then it's
// optional (brief §3.1b, US-C-06).
export default function HomePage() {
  const [categories, setCategories] = useState<CategoryDto[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | undefined>(undefined);
  const [vendors, setVendors] = useState<VendorDto[] | null>(null);
  const [deals, setDeals] = useState<ProductListingDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [slide, setSlide] = useState(0);
  const { add, dialog } = useQuickAdd();
  const router = useRouter();

  // First visit in this browser: show the intro once (it is skippable, and never shown again after).
  useEffect(() => {
    try {
      if (!window.localStorage.getItem(ONBOARDED_KEY)) router.replace("/welcome");
    } catch {
      // Storage blocked — skip the intro rather than loop on it.
    }
  }, [router]);

  useEffect(() => {
    catalogApi.listCategories().then((res) => setCategories(res.categories)).catch(() => {});
    // An API that predates sale prices just has no deals — the section hides, nothing breaks.
    catalogApi.listDeals(10).then((res) => setDeals(res.products)).catch(() => {});
  }, []);

  useEffect(() => {
    setVendors(null);
    setError(null);
    catalogApi
      .searchVendors({ category: activeCategory, limit: 30 })
      .then((res) => setVendors(res.vendors))
      .catch((err) => setError(err instanceof ApiClientError ? err.message : "Couldn't load shops."));
  }, [activeCategory]);

  const slides = deals.slice(0, MAX_SLIDES);
  useEffect(() => {
    if (slides.length < 2) return;
    const t = setInterval(() => setSlide((s) => (s + 1) % slides.length), SLIDE_MS);
    return () => clearInterval(t);
  }, [slides.length]);

  const current = slides[slide % Math.max(slides.length, 1)];
  const openCount = vendors?.filter((v) => v.isOpen).length ?? 0;

  return (
    <div className="flex flex-col">
      <AppHeader />

      <div className="flex flex-col gap-[22px] px-4 pb-24 pt-4 lg:gap-14 lg:px-0 lg:pb-8 lg:pt-10">
        <div className="flex flex-col gap-[22px] lg:grid lg:grid-cols-2 lg:items-stretch lg:gap-6">
          <div className="flex flex-col gap-3 lg:justify-center lg:gap-5">
            <h1 className="text-[30px] font-semibold leading-[1.08] tracking-[-0.035em] text-ink lg:text-[64px] lg:leading-[1.02] lg:tracking-[-0.045em]">
              Daily needs,
              <br />
              <span className="text-accent">delivered fast.</span>
            </h1>
            <Link
              href="/search"
              className="flex h-[46px] items-center gap-2.5 rounded-xl bg-card pl-3.5 pr-1.5 text-sm text-muted shadow-[0_0_0_1px_rgb(var(--c-line))]"
            >
              <Search size={16} strokeWidth={2} aria-hidden="true" />
              <span className="flex-1">Search products, shops…</span>
              <span className="rounded-md bg-raised px-[7px] py-1 font-mono text-[11px] text-ink">/</span>
            </Link>
          </div>

          <section
            aria-label="Offers"
            className="relative flex min-h-[176px] flex-col gap-2.5 overflow-hidden rounded-2xl bg-primary p-[18px] text-[#F3EEE9] lg:min-h-[380px] lg:rounded-[18px] lg:p-7"
          >
            <svg width="100%" height="100%" aria-hidden="true" className="absolute inset-0 opacity-[0.18]">
              <defs>
                <pattern id="home-grid" width="20" height="20" patternUnits="userSpaceOnUse">
                  <path d="M20 0H0V20" fill="none" stroke="#F3EEE9" strokeWidth="0.6" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#home-grid)" />
            </svg>
            {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset */}
            <img src="/logo-mark.png" alt="" className="pointer-events-none absolute -bottom-[34px] -right-[26px] h-[158px] w-[150px] opacity-90" />
            {current ? (
              <>
                <span className="relative flex items-center gap-1.5 self-start rounded-md bg-[#F3EEE9]/[0.12] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.06em]">
                  <span className="h-[5px] w-[5px] rounded-full bg-accent" aria-hidden="true" />
                  {discountOff(current)}% off · {current.vendorName}
                </span>
                <span className="relative max-w-[230px] text-[22px] font-semibold leading-[1.15] tracking-[-0.025em]">
                  {current.name} <span className="text-[#FF8A5C]">−{discountOff(current)}%</span>
                </span>
                <div className="relative mt-auto flex items-center justify-between">
                  <Link
                    href={`/products/${current.id}`}
                    className="flex h-[38px] items-center gap-1.5 rounded-[10px] bg-accent px-3.5 text-[13px] font-semibold text-[#0E1F19]"
                  >
                    Shop this deal <MonoArrow />
                  </Link>
                  <div className="flex">
                    {slides.map((s, i) => (
                      <button key={s.id} type="button" onClick={() => setSlide(i)} aria-label={`Show offer ${i + 1}`} className="flex h-11 w-[22px] items-center justify-center">
                        <span className={`block h-1 rounded-sm transition-all duration-200 ${i === slide % slides.length ? "w-[18px] bg-accent" : "w-1.5 bg-[#F3EEE9]/35"}`} />
                      </button>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <>
                <span className="relative flex items-center gap-1.5 self-start rounded-md bg-[#F3EEE9]/[0.12] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.06em]">
                  <span className="h-[5px] w-[5px] rounded-full bg-accent" aria-hidden="true" />
                  Riverpark · local shops
                </span>
                <span className="relative max-w-[230px] text-[22px] font-semibold leading-[1.15] tracking-[-0.025em]">
                  Everything nearby, <span className="text-[#FF8A5C]">brought to you.</span>
                </span>
                <div className="relative mt-auto">
                  <Link href="/search" className="inline-flex h-[38px] items-center gap-1.5 rounded-[10px] bg-accent px-3.5 text-[13px] font-semibold text-[#0E1F19]">
                    Start shopping <MonoArrow />
                  </Link>
                </div>
              </>
            )}
          </section>
        </div>

        <section className="flex flex-col gap-2.5">
          <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">Categories</span>
          <CategoryChips categories={categories} active={activeCategory} onSelect={setActiveCategory} />
        </section>

        {deals.length > 0 && (
          <section className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">Deals near you</span>
              <Link href="/search?sale=1" className="py-3 text-[13px] font-medium text-ink">
                View all <MonoArrow className="ml-0.5" />
              </Link>
            </div>
            <div className="-mx-4 flex gap-2.5 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] lg:mx-0 lg:grid lg:grid-cols-5 lg:gap-3 lg:overflow-visible lg:px-0">
              {deals.map((p) => (
                <DealCard key={p.id} product={p} onAdd={add} />
              ))}
            </div>
          </section>
        )}

        <section className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
              {activeCategory ? `${categories.find((c) => c.id === activeCategory)?.name ?? "Shops"} near you` : "Shops near you"}
            </span>
            {vendors && <span className="font-mono text-[11px] uppercase text-muted">{openCount} open</span>}
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}

          {vendors === null && !error ? (
            <div className="flex flex-col gap-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-[60px] animate-pulse rounded-[14px] bg-raised" />
              ))}
            </div>
          ) : vendors && vendors.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-raised text-muted">
                <Store size={22} />
              </span>
              <p className="text-sm font-medium text-ink">{activeCategory ? "No shops in this category yet" : "No shops here yet"}</p>
              <p className="text-xs text-muted">Check back soon, or try another category.</p>
            </div>
          ) : vendors ? (
            <div className="overflow-hidden rounded-[14px] bg-card shadow-[0_0_0_1px_rgb(var(--c-line))] lg:grid lg:grid-cols-3 lg:gap-3 lg:overflow-visible lg:rounded-none lg:bg-transparent lg:shadow-none">
              {vendors.map((vendor) => (
                <VendorRow key={vendor.id} vendor={vendor} />
              ))}
            </div>
          ) : null}
        </section>
      </div>

      {dialog}
    </div>
  );
}
