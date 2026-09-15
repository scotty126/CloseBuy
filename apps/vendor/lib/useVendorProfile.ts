"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiClientError } from "@closebuy/api-client";
import type { OwnVendorProfileDto } from "@closebuy/types";
import { catalogApi } from "./api";

/**
 * Every "real" screen (Orders/Products/Settings/Earnings) needs to know
 * the same thing first: does this signed-in account have a VendorProfile
 * at all, and if so what status is it in (US-V-01's application isn't
 * instant). Centralized here once rather than repeated per page —
 * VendorGate.tsx is the thing that actually branches on it.
 */
export function useVendorProfile(enabled: boolean) {
  const [vendor, setVendor] = useState<OwnVendorProfileDto | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(() => {
    if (!enabled) {
      setIsLoaded(true);
      return;
    }
    catalogApi
      .getOwnVendor()
      .then((res) => {
        setVendor(res.vendor);
        setNotFound(false);
        setError(null);
      })
      .catch((err) => {
        if (err instanceof ApiClientError && err.status === 404) {
          setNotFound(true);
        } else {
          setError(err instanceof ApiClientError ? err.message : "Couldn't load your vendor profile.");
        }
      })
      .finally(() => setIsLoaded(true));
  }, [enabled]);

  useEffect(() => {
    refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return { vendor, notFound, isLoaded, error, refetch };
}
