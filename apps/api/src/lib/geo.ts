import type { PrismaClient } from "@prisma/client";
import { getConfigValue } from "./config.js";

export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * Ray-casting point-in-polygon test — standard, dependency-free algorithm.
 * The polygon is a closed ring of [lat, lng] pairs; doesn't matter whether
 * the first point is repeated at the end or not.
 */
export function isPointInPolygon(point: LatLng, polygon: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const pi = polygon[i]!;
    const pj = polygon[j]!;
    const intersects =
      pi.lng > point.lng !== pj.lng > point.lng &&
      point.lat < ((pj.lat - pi.lat) * (point.lng - pi.lng)) / (pj.lng - pi.lng) + pi.lat;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * The launch service area (brief §2a — Riverpark first), admin-configurable
 * the same way commission rates are (US-A-02, lib/config.ts). One polygon
 * for the whole platform today, because there's only one launch area; the
 * moment a second city opens, this needs to become "which service area is
 * this vendor/order actually in" rather than a single global polygon — not
 * built ahead of that need.
 */
export async function getServiceAreaPolygon(prisma: PrismaClient): Promise<LatLng[]> {
  return getConfigValue<LatLng[]>(prisma, "service_area_polygon");
}

export async function isWithinServiceArea(prisma: PrismaClient, lat: number, lng: number): Promise<boolean> {
  const polygon = await getServiceAreaPolygon(prisma);
  return isPointInPolygon({ lat, lng }, polygon);
}
