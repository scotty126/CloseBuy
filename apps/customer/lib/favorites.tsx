"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuthSession } from "@closebuy/ui";
import { favoritesApi } from "@/lib/api";

interface FavoritesContextValue {
  /** True once we know whether there is a signed-in customer (and, if so, their saved ids). */
  isLoaded: boolean;
  isFavorite: (productId: string) => boolean;
  isFollowing: (vendorId: string) => boolean;
  /** Optimistic. A guest is sent to /login — a heart needs an account to live on. */
  toggle: (productId: string) => Promise<void>;
  toggleFollow: (vendorId: string) => Promise<void>;
}

const FavoritesContext = createContext<FavoritesContextValue | null>(null);

/** Optimistic set toggle with rollback — a heart must never show a state the server doesn't have. */
function useOptimisticSet() {
  const [ids, setIds] = useState<Set<string>>(new Set());
  const apply = useCallback((id: string, on: boolean) => {
    setIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  return { ids, setIds, apply };
}

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { session, isLoaded: sessionLoaded } = useAuthSession();
  const products = useOptimisticSet();
  const vendors = useOptimisticSet();
  const [isLoaded, setIsLoaded] = useState(false);

  const isCustomer = Boolean(session && session.user.role === "customer");

  useEffect(() => {
    if (!sessionLoaded) return;
    if (!isCustomer) {
      products.setIds(new Set());
      vendors.setIds(new Set());
      setIsLoaded(true);
      return;
    }
    // An API that predates favourites (or a blip) just means no hearts filled — never an error on a page.
    Promise.all([
      favoritesApi.list().then((res) => products.setIds(new Set(res.products.map((p) => p.id)))).catch(() => products.setIds(new Set())),
      favoritesApi.listFollowedVendorIds().then((res) => vendors.setIds(new Set(res.vendorIds))).catch(() => vendors.setIds(new Set())),
    ]).finally(() => setIsLoaded(true));
    // products/vendors setters are stable; the session is what should retrigger a load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCustomer, sessionLoaded]);

  const toggleIn = useCallback(
    async (set: ReturnType<typeof useOptimisticSet>, id: string, add: () => Promise<unknown>, remove: () => Promise<unknown>) => {
      if (!isCustomer) {
        router.push("/login");
        return;
      }
      const was = set.ids.has(id);
      set.apply(id, !was);
      try {
        await (was ? remove() : add());
      } catch {
        set.apply(id, was);
      }
    },
    [isCustomer, router],
  );

  const value = useMemo<FavoritesContextValue>(
    () => ({
      isLoaded,
      isFavorite: (id) => products.ids.has(id),
      isFollowing: (id) => vendors.ids.has(id),
      toggle: (id) => toggleIn(products, id, () => favoritesApi.add(id), () => favoritesApi.remove(id)),
      toggleFollow: (id) => toggleIn(vendors, id, () => favoritesApi.followVendor(id), () => favoritesApi.unfollowVendor(id)),
    }),
    [isLoaded, products, vendors, toggleIn],
  );

  return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>;
}

export function useFavorites(): FavoritesContextValue {
  const ctx = useContext(FavoritesContext);
  if (!ctx) throw new Error("useFavorites must be used inside <FavoritesProvider>");
  return ctx;
}
