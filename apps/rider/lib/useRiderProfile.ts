"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiClientError } from "@closebuy/api-client";
import type { RiderProfileDto } from "@closebuy/types";
import { dispatchApi } from "./api";

/** Mirrors the vendor app's useVendorProfile — same shape of gap: a signed-in phone/OTP account has no RiderProfile until US-R-01's application step is submitted and approved. */
export function useRiderProfile(enabled: boolean) {
  const [rider, setRider] = useState<RiderProfileDto | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(() => {
    if (!enabled) {
      setIsLoaded(true);
      return;
    }
    dispatchApi
      .getOwnRider()
      .then((res) => {
        setRider(res.rider);
        setNotFound(false);
        setError(null);
      })
      .catch((err) => {
        if (err instanceof ApiClientError && err.status === 404) {
          setNotFound(true);
        } else {
          setError(err instanceof ApiClientError ? err.message : "Couldn't load your rider profile.");
        }
      })
      .finally(() => setIsLoaded(true));
  }, [enabled]);

  useEffect(() => {
    refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return { rider, notFound, isLoaded, error, refetch };
}
