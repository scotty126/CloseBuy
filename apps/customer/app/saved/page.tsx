"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Heart } from "lucide-react";
import { ThemeToggle, useAuthSession } from "@closebuy/ui";
import type { ProductListingDto } from "@closebuy/types";
import { favoritesApi } from "@/lib/api";
import { useFavorites } from "@/lib/favorites";
import { ProductRow } from "@/components/ProductRow";
import { useQuickAdd } from "@/components/useQuickAdd";

/** Saved products — the other end of the heart on every product card. Signed-in customers only. */
export default function SavedPage() {
  const router = useRouter();
  const { session, isLoaded } = useAuthSession();
  const { isFavorite } = useFavorites();
  const [products, setProducts] = useState<ProductListingDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { add, dialog } = useQuickAdd();

  useEffect(() => {
    if (!isLoaded || !session) return;
    favoritesApi
      .list()
      .then((res) => setProducts(res.products))
      .catch(() => {
        setProducts([]);
        setError("Couldn't load your saved items.");
      });
  }, [isLoaded, session]);

  if (!isLoaded) return null;

  // Un-hearting on this screen drops the card straight away rather than leaving a ghost row.
  const shown = products?.filter((p) => isFavorite(p.id)) ?? null;

  return (
    <div className="flex flex-col">
      <header className="flex items-center gap-2 px-4 pb-3 pt-[18px]">
        <button
          type="button"
          onClick={() => (window.history.length > 1 ? router.back() : router.push("/account"))}
          aria-label="Back"
          className="flex h-11 w-11 items-center justify-center rounded-[14px] bg-card text-ink"
        >
          <ArrowLeft size={18} strokeWidth={2.2} />
        </button>
        <h1 className="flex-1 text-[26px] font-semibold tracking-[-0.02em] text-ink">Saved</h1>
        <ThemeToggle />
      </header>

      <div className="flex flex-col gap-3 px-4 pb-6">
        {!session ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-raised text-accent">
              <Heart size={22} />
            </span>
            <p className="max-w-xs text-sm text-muted">Sign in to save items and find them again here.</p>
            <Link href="/login" className="flex h-11 items-center rounded-xl bg-accent px-5 text-sm font-semibold text-night">
              Sign in
            </Link>
          </div>
        ) : shown === null ? (
          <div className="flex flex-col gap-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-[14px] bg-raised" />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-raised text-accent">
              <Heart size={22} />
            </span>
            <p className="text-sm font-medium text-ink">{error ?? "Nothing saved yet"}</p>
            <p className="text-xs text-muted">Tap the heart on any item to keep it here.</p>
            <Link href="/search" className="text-[13px] font-semibold text-primary underline dark:text-[#8FD1B5]">
              Find something to save
            </Link>
          </div>
        ) : (
          shown.map((p) => <ProductRow key={p.id} product={p} onAdd={add} />)
        )}
      </div>

      {dialog}
    </div>
  );
}
