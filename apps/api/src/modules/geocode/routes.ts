import type { FastifyInstance } from "fastify";
import { geocodeSearchQuerySchema, geocodeReverseQuerySchema } from "@closebuy/types";
import { createGeocodeService } from "./service.js";

/**
 * Address search backing checkout's "type a street/area name" flow — NOT a
 * replacement for the pin+landmark model (brief §3.4: street addressing is
 * unreliable across much of the launch market, so a text address alone
 * must never be assumed to work for distance/routing or the service-area
 * check). This only ever *suggests* a starting pin; the coordinate the
 * customer ends up with — refined by dragging, "use my current location",
 * or typed by hand — is still the one thing checkout actually validates
 * against the service-area polygon, exactly as before this existed.
 *
 * Backed by Nominatim (OpenStreetMap), not Google Places —
 * NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is still unset (Google Cloud Billing
 * won't complete for this account, CLAUDE.md's Known issues) and Nominatim
 * needs no API key or billing at all. Worth revisiting once that's
 * unblocked — Google's results are generally better for Nigerian addresses
 * — but this module's shape (search -> [{label,lat,lng}], reverse ->
 * label) is deliberately provider-agnostic, so swapping it later is a
 * one-file change in service.ts, not a rewrite of the routes or the
 * frontend that calls them.
 */
export async function geocodeRoutes(app: FastifyInstance) {
  const geocode = createGeocodeService(app.prisma);

  app.get("/geocode/search", async (req, reply) => {
    const { q } = geocodeSearchQuerySchema.parse(req.query);
    const results = await geocode.search(q);
    return reply.send({ results });
  });

  app.get("/geocode/reverse", async (req, reply) => {
    const { lat, lng } = geocodeReverseQuerySchema.parse(req.query);
    const label = await geocode.reverse(lat, lng);
    return reply.send({ label });
  });
}
