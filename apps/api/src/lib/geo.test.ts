import { describe, it, expect } from "vitest";
import { isPointInPolygon } from "./geo.js";

// A simple 0-10/0-10 square — the algorithm itself doesn't care about real
// coordinates, and a square is the easiest shape to reason about clear-cut
// inside/outside/edge cases against.
const SQUARE = [
  { lat: 0, lng: 0 },
  { lat: 0, lng: 10 },
  { lat: 10, lng: 10 },
  { lat: 10, lng: 0 },
];

describe("isPointInPolygon (lib/geo.ts) — the mechanism behind US-C-05's service-area check", () => {
  it("a point well inside the polygon is inside", () => {
    expect(isPointInPolygon({ lat: 5, lng: 5 }, SQUARE)).toBe(true);
  });

  it("a point well outside the polygon is outside", () => {
    expect(isPointInPolygon({ lat: 55, lng: 55 }, SQUARE)).toBe(false);
  });

  it("a point just across the boundary is outside", () => {
    expect(isPointInPolygon({ lat: 5, lng: 10.001 }, SQUARE)).toBe(false);
  });

  it("a point just inside the boundary is inside", () => {
    expect(isPointInPolygon({ lat: 5, lng: 9.999 }, SQUARE)).toBe(true);
  });

  it("works for an irregular (non-rectangular) polygon too, not just axis-aligned boxes", () => {
    const triangle = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 10 },
      { lat: 10, lng: 5 },
    ];
    expect(isPointInPolygon({ lat: 2, lng: 5 }, triangle)).toBe(true); // inside the triangle
    expect(isPointInPolygon({ lat: 9, lng: 1 }, triangle)).toBe(false); // outside the triangle, though inside its bounding box
  });

  it("a Null-Island-style placeholder polygon would fail closed against every real-world coordinate", () => {
    // Documents the fail-closed property this mechanism relies on — not
    // what prisma/seed.ts actually seeds any more (that's Riverpark's
    // real traced boundary), but the property that made it safe to seed a
    // placeholder there in the first place, if one is ever needed again.
    const placeholder = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.001 },
      { lat: 0.001, lng: 0.001 },
      { lat: 0.001, lng: 0 },
    ];
    expect(isPointInPolygon({ lat: 9.05, lng: 7.4 }, placeholder)).toBe(false); // a real Abuja-area point, for scale
  });
});
