import type { PrismaClient } from "@prisma/client";
import type { GeocodeResultDto } from "@closebuy/types";
import { getServiceAreaPolygon, type LatLng } from "../../lib/geo.js";

/**
 * Thrown when Nominatim can't be reached or errors — never for "no results
 * found" (that's a legitimate empty array). The API's error handler turns
 * this into a 503; checkout's real fallbacks (current-location, manual
 * coordinates) still work regardless, so this is never fatal to placing an
 * order, only to the search-suggestions convenience.
 */
export class GeocodeUnavailableError extends Error {
  constructor(message = "Address search isn't available right now. Use your current location or enter coordinates manually.", options?: ErrorOptions) {
    super(message, options);
  }
}

// A real, identifying User-Agent — Nominatim's usage policy requires one (or a Referer) on every request, and
// anonymous/generic clients get blocked. This names the product and its public URL, nothing personal — never a
// developer's own contact details, which have no business being sent to an unrelated third-party service.
const USER_AGENT = "CloseBuy/1.0 (+https://closebuy1.netlify.app)";
const NOMINATIM_BASE = "https://nominatim.openstreetmap.org";

// Usage policy: max 1 request/second, and it's a shared public resource — this throttle applies across every
// caller of one service instance, not per-request or per-caller, matching what the policy actually asks for
// (the real app builds exactly one instance, at route-registration time, so this is genuinely process-wide
// there). A real scaling limit worth knowing: past a handful of concurrent searchers, requests start queuing
// visibly. The fix then is either self-hosting Nominatim or switching to a paid provider (Google, once billing
// is unblocked) — not raising this number, which would just get the app rate-limited or blocked outright.
const DEFAULT_MIN_INTERVAL_MS = 1100;
const CACHE_TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;

interface CacheEntry {
  at: number;
  results: GeocodeResultDto[];
}

function boundingBoxOf(polygon: LatLng[]) {
  const lats = polygon.map((p) => p.lat);
  const lngs = polygon.map((p) => p.lng);
  return { minLat: Math.min(...lats), maxLat: Math.max(...lats), minLng: Math.min(...lngs), maxLng: Math.max(...lngs) };
}

// minIntervalMs is only ever overridden by tests, to check the throttle mechanism itself works without
// actually waiting out the real policy interval on every test run — production always uses the real default.
export function createGeocodeService(prisma: PrismaClient, minIntervalMs = DEFAULT_MIN_INTERVAL_MS) {
  // Closed over, not module-level: the real app still gets one shared clock/cache for the process (routes.ts
  // constructs this service exactly once), but each test constructing its own instance gets its own state
  // too, rather than bleeding throttle/cache timing into unrelated tests via shared module globals.
  const searchCache = new Map<string, CacheEntry>();
  let lastRequestAt = 0;

  async function throttledFetch(url: string): Promise<Response> {
    const wait = Math.max(0, lastRequestAt + minIntervalMs - Date.now());
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequestAt = Date.now();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      return await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" }, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    /**
     * Address text -> candidate pins, restricted to the *real, current*
     * service area (read from Config the same way checkout's own
     * OutsideServiceAreaError check does, not a second hardcoded copy of
     * the polygon that could drift out of sync with it) — never suggests
     * an address CloseBuy can't actually deliver to. A search that matches
     * nothing inside the area returns an empty array, not an error.
     */
    async search(query: string): Promise<GeocodeResultDto[]> {
      const key = query.trim().toLowerCase();
      const cached = searchCache.get(key);
      if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.results;

      const polygon = await getServiceAreaPolygon(prisma);
      const { minLat, maxLat, minLng, maxLng } = boundingBoxOf(polygon);
      // Nominatim's viewbox is <left>,<top>,<right>,<bottom> = minLng,maxLat,maxLng,minLat — easy to get
      // backwards, which silently returns global results instead of an error, so spelled out here rather than
      // inlined. bounded=1 makes it a hard filter, not just a preference — see the search()-vs-suggests-only
      // note on the class doc above for why that's the right call here, not just a tuning knob.
      const url =
        `${NOMINATIM_BASE}/search?format=jsonv2&limit=5&addressdetails=0&q=${encodeURIComponent(query)}` +
        `&viewbox=${minLng},${maxLat},${maxLng},${minLat}&bounded=1`;

      let res: Response;
      try {
        res = await throttledFetch(url);
      } catch (err) {
        throw new GeocodeUnavailableError(undefined, { cause: err });
      }
      if (!res.ok) throw new GeocodeUnavailableError(undefined, { cause: new Error(`Nominatim ${res.status}`) });

      const data = (await res.json()) as Array<{ display_name: string; lat: string; lon: string }>;
      const results = data.map((r) => ({ label: r.display_name, lat: Number(r.lat), lng: Number(r.lon) }));
      searchCache.set(key, { at: Date.now(), results });
      return results;
    },

    /**
     * Coordinate -> a human label, best-effort. Used so a pin set via
     * "Use my current location" (or a dragged map pin) can show something
     * readable instead of raw numbers too — this isn't only about typed
     * search. Never throws: a failure here just means the caller falls
     * back to showing the coordinates, exactly like before this existed,
     * never a reason to block checkout.
     */
    async reverse(lat: number, lng: number): Promise<string | null> {
      const url = `${NOMINATIM_BASE}/reverse?format=jsonv2&zoom=18&addressdetails=0&lat=${lat}&lon=${lng}`;
      try {
        const res = await throttledFetch(url);
        if (!res.ok) return null;
        const data = (await res.json()) as { display_name?: string };
        return data.display_name ?? null;
      } catch {
        return null;
      }
    },
  };
}
