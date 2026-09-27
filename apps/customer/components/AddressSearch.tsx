"use client";

import { useEffect, useRef, useState } from "react";
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
export function AddressSearch({ onSelect }: { onSelect: (result: GeocodeResultDto) => void }) {
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
      <label htmlFor="address-search" className="text-sm font-medium text-ink">
        Street or area name
      </label>
      {/* The dropdown anchors to this inner wrapper, not the whole component — otherwise its position would
          shift depending on whether the loading/error line below is currently rendered. */}
      <div className="relative">
        <input
          id="address-search"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results && results.length > 0 && setOpen(true)}
          placeholder="e.g. Cluster 2 Road, Riverpark"
          autoComplete="off"
          className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
        />
        {open && results && results.length > 0 && (
          <ul className="absolute top-full z-10 mt-1 w-full overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
            {results.map((r) => (
              <li key={`${r.lat},${r.lng}`}>
                <button
                  type="button"
                  onClick={() => {
                    onSelect(r);
                    setQuery(r.label);
                    setOpen(false);
                  }}
                  className="block w-full px-3 py-2 text-left text-sm text-ink hover:bg-surface"
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
