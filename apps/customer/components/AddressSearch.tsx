"use client";

import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { ApiClientError } from "@closebuy/api-client";
import type { GeocodeResultDto } from "@closebuy/types";
import { geocodeApi } from "@/lib/api";

// A real pause between words, comfortably past Nominatim's usage-policy throttle (apps/api's geocode/service.ts
// queues outbound requests to ~1/sec platform-wide) — debouncing here keeps this app a well-behaved caller of
// that shared budget instead of firing a request per keystroke.
const DEBOUNCE_MS = 450;
const MIN_QUERY_LENGTH = 3;

/**
 * "Type your street/area, pick a pin" — the discovery half of checkout's
 * delivery-location step. Deliberately not the *only* way to set a pin:
 * brief §3.4 is explicit that street addressing is unreliable across much
 * of the launch market, so a match here is a starting point to refine
 * (current-location, dragging the map, or typing coordinates by hand all
 * still exist alongside this), never assumed to be exactly right on its
 * own. Results only ever come from inside the real service area
 * (geocode/service.ts scopes the search to it) — a normal empty state,
 * not an error, when nothing inside Riverpark matches.
 */
export function AddressSearch({ onSelect, pill = false }: { onSelect: (result: GeocodeResultDto) => void; pill?: boolean }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResultDto[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0); // guards a slow, stale search from overwriting a newer one's results
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setResults(null);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    debounceRef.current = setTimeout(() => {
      const id = ++requestIdRef.current;
      geocodeApi
        .search(trimmed)
        .then((res) => {
          if (id !== requestIdRef.current) return;
          setResults(res.results);
          setError(null);
          setOpen(true);
        })
        .catch((err) => {
          if (id !== requestIdRef.current) return;
          setResults(null);
          setError(err instanceof ApiClientError ? err.message : "Couldn't search right now.");
        })
        .finally(() => {
          if (id === requestIdRef.current) setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  return (
    <div ref={containerRef} className="flex flex-col gap-1.5">
      <label htmlFor="address-search" className={pill ? "sr-only" : "text-sm font-medium text-ink"}>
        Street or area name
      </label>
      {/* The dropdown anchors to this inner wrapper, not the whole component — otherwise its position would
          shift depending on whether the loading/error line below is currently rendered. */}
      <div className="relative">
        {pill && <Search size={18} strokeWidth={2} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />}
        <input
          id="address-search"
          type={pill ? "search" : "text"}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results && results.length > 0 && setOpen(true)}
          placeholder={pill ? "Search street or estate" : "e.g. Cluster 2 Road, Riverpark"}
          autoComplete="off"
          className={
            pill
              ? "h-[52px] w-full rounded-2xl border-0 bg-card pl-11 pr-4 text-[15px] text-ink outline-none placeholder:text-muted focus:shadow-[inset_0_0_0_2px_#FF5A19]"
              : "w-full rounded-xl border border-line bg-card px-3 py-2.5 text-sm text-ink outline-none placeholder:text-muted/60 transition-all duration-150 ease-out hover:border-primary/40 focus:border-primary focus:ring-4 focus:ring-primary/10"
          }
        />
        {open && results && results.length > 0 && (
          <ul className="absolute top-full z-10 mt-1 w-full animate-fade-in overflow-hidden rounded-xl border border-line bg-card shadow-lg">
            {results.map((r) => (
              <li key={`${r.lat},${r.lng}`}>
                <button
                  type="button"
                  onClick={() => {
                    onSelect(r);
                    setQuery(r.label);
                    setOpen(false);
                  }}
                  className="block w-full px-3 py-2 text-left text-sm text-ink transition-colors hover:bg-surface"
                >
                  {r.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {loading && <p className="text-xs text-muted">Searching…</p>}
      {error && <p className="text-xs text-danger">{error}</p>}
      {open && results && results.length === 0 && (
        <p className="text-xs text-muted">No match inside Riverpark for that — try current location, or a different spelling.</p>
      )}
    </div>
  );
}
