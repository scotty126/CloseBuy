import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createGeocodeService, GeocodeUnavailableError } from "./service.js";

const POLYGON = [
  { lat: 8.97, lng: 7.33 },
  { lat: 8.99, lng: 7.33 },
  { lat: 8.99, lng: 7.35 },
  { lat: 8.97, lng: 7.35 },
];

// A few ms, not the real ~1100ms policy interval — each test below builds its own service instance (state is
// closed over per-instance, not module-level, see service.ts), so this only needs to be fast, not zero: the
// "throttles..." test still has to observe a real, measurable delay to prove the mechanism works.
const FAST_INTERVAL_MS = 15;

function fakePrisma(): PrismaClient {
  return {
    config: {
      findFirst: vi.fn().mockResolvedValue({ value: POLYGON }),
    },
  } as unknown as PrismaClient;
}

function service() {
  return createGeocodeService(fakePrisma(), FAST_INTERVAL_MS);
}

function fakeNominatimResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response;
}

describe("geocode service (apps/api/src/modules/geocode/service.ts)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps a Nominatim search response to { label, lat, lng }", async () => {
    fetchMock.mockResolvedValue(
      fakeNominatimResponse([
        { display_name: "Cluster 2 Road, Riverpark", lat: "8.98", lon: "7.34" },
        { display_name: "Cluster 3 Road, Riverpark", lat: "8.981", lon: "7.341" },
      ]),
    );
    const results = await service().search("cluster 2");
    expect(results).toEqual([
      { label: "Cluster 2 Road, Riverpark", lat: 8.98, lng: 7.34 },
      { label: "Cluster 3 Road, Riverpark", lat: 8.981, lng: 7.341 },
    ]);
  });

  it("scopes the search to the REAL, current service-area polygon from Config — not a hardcoded copy", async () => {
    fetchMock.mockResolvedValue(fakeNominatimResponse([]));
    await service().search("anything");

    const calledUrl = fetchMock.mock.calls[0]![0] as string;
    // viewbox is left,top,right,bottom = minLng,maxLat,maxLng,minLat — this asserts the actual bounding box
    // derived from POLYGON above, so a future refactor that gets the corner order backwards fails loudly here
    // instead of silently returning global results.
    expect(calledUrl).toContain("viewbox=7.33,8.99,7.35,8.97");
    expect(calledUrl).toContain("bounded=1");
  });

  it("sends a real identifying User-Agent, per Nominatim's usage policy — never fetches anonymously", async () => {
    fetchMock.mockResolvedValue(fakeNominatimResponse([]));
    await service().search("anything");

    const headers = fetchMock.mock.calls[0]![1]?.headers as Record<string, string>;
    expect(headers["User-Agent"]).toMatch(/CloseBuy/);
  });

  it("an empty result set is a normal answer, not an error", async () => {
    fetchMock.mockResolvedValue(fakeNominatimResponse([]));
    await expect(service().search("nowhere")).resolves.toEqual([]);
  });

  it("throws GeocodeUnavailableError (not a raw exception) when Nominatim answers with a non-2xx", async () => {
    fetchMock.mockResolvedValue(fakeNominatimResponse({}, false, 502));
    await expect(service().search("test")).rejects.toThrow(GeocodeUnavailableError);
  });

  it("throws GeocodeUnavailableError when the network call itself fails", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    await expect(service().search("test")).rejects.toThrow(GeocodeUnavailableError);
  });

  it("caches an identical query instead of calling Nominatim again", async () => {
    fetchMock.mockResolvedValue(fakeNominatimResponse([{ display_name: "X", lat: "8.98", lon: "7.34" }]));
    const s = service();
    await s.search("repeat");
    await s.search("repeat"); // same query, same case-folding
    await s.search("Repeat"); // same query, different case — still a cache hit

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throttles consecutive outbound calls to roughly the configured policy interval", async () => {
    fetchMock.mockResolvedValue(fakeNominatimResponse([]));
    const s = service();
    await s.search("throttle-a"); // primes lastRequestAt
    const start = Date.now();
    await s.search("throttle-b"); // different query — a real second outbound call, not a cache hit
    expect(Date.now() - start).toBeGreaterThanOrEqual(FAST_INTERVAL_MS - 5); // small epsilon for clock jitter
  });

  it("reverse() returns a label on success", async () => {
    fetchMock.mockResolvedValue(fakeNominatimResponse({ display_name: "Riverpark Cluster 1" }));
    await expect(service().reverse(8.98, 7.337)).resolves.toBe("Riverpark Cluster 1");
  });

  it("reverse() degrades to null instead of throwing — it must never block checkout", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    await expect(service().reverse(8.98, 7.337)).resolves.toBeNull();

    fetchMock.mockResolvedValue(fakeNominatimResponse({}, false, 500));
    await expect(service().reverse(8.98, 7.337)).resolves.toBeNull();
  });
});
