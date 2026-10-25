"use client";

import { useState } from "react";
import Link from "next/link";
import { ApiClientError } from "@closebuy/api-client";
import type { OwnVendorProfileDto } from "@closebuy/types";
import { catalogApi } from "@/lib/api";

/**
 * The redesign's page header: title + a mono sub-line, with the shop's
 * open/closed switch (the one control a seller reaches for mid-shift) and a
 * bell. The switch writes the same `isOpen` Settings does, so the two never
 * disagree.
 */
export function PageHeader({
  title,
  subtitle,
  vendor,
  onVendorChanged,
}: {
  title: string;
  subtitle?: string;
  vendor?: OwnVendorProfileDto;
  onVendorChanged?: () => void;
}) {
  const [open, setOpen] = useState(vendor?.isOpen ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function flip() {
    if (!vendor || busy) return;
    const next = !open;
    setOpen(next); // optimistic; rolled back below if the server refuses
    setBusy(true);
    setError(null);
    try {
      await catalogApi.updateOwnVendor({ isOpen: next });
      onVendorChanged?.();
    } catch (err) {
      setOpen(!next);
      setError(err instanceof ApiClientError ? err.message : "Couldn't update.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-ink">{title}</h1>
        {subtitle && <span className="font-mono text-[11px] uppercase text-muted">{subtitle}</span>}
        {error && <span className="text-xs text-danger">{error}</span>}
      </div>
      {vendor && (
        <button
          type="button"
          role="switch"
          aria-checked={open}
          aria-label="Shop open for orders"
          onClick={flip}
          className="flex h-11 items-center gap-2 px-1"
        >
          <span className="hidden text-[13px] text-muted sm:inline">{open ? "Open for orders" : "Closed"}</span>
          <span className={`flex h-6 w-11 items-center rounded-full p-0.5 transition-colors ${open ? "bg-success" : "bg-muted/40"}`}>
            <span className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${open ? "translate-x-5" : ""}`} />
          </span>
        </button>
      )}
      <Link href="/notifications" aria-label="Notifications" className="flex h-11 w-11 items-center justify-center text-ink">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0" />
        </svg>
      </Link>
    </div>
  );
}
