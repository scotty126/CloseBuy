"use client";

import { useCallback, useEffect, useState } from "react";
import type { AuthSession } from "@closebuy/types";

const STORAGE_KEY = "closebuy.session";

/**
 * Client-side session storage shared by all four apps — deliberately just
 * localStorage for M0 (single-tab, no cross-device sync needed yet). Every
 * app's login page and every authenticated screen reads/writes through
 * this one hook rather than touching localStorage directly, so upgrading
 * the storage strategy later (e.g. httpOnly cookies via a Next.js route
 * handler, for stronger XSS protection) is a one-file change.
 */
export function useAuthSession() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) setSession(JSON.parse(raw) as AuthSession);
    } catch {
      // Private-browsing / storage-blocked — proceed logged out rather than throw.
    } finally {
      setIsLoaded(true);
    }
  }, []);

  const save = useCallback((next: AuthSession) => {
    setSession(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore — session still works for this tab via React state.
    }
  }, []);

  const clear = useCallback(() => {
    setSession(null);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // no-op
    }
  }, []);

  return { session, isLoaded, save, clear };
}
