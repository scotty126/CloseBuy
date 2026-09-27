import { z } from "zod";

// GET /geocode/search — a customer types a street/area name; this suggests candidate pins. Never the source
// of truth on its own (brief §3.4 — street addressing is unreliable across much of the launch market), only a
// faster way to set the same lat/lng checkout already required before this existed.
export const geocodeSearchQuerySchema = z.object({
  q: z.string().trim().min(3, "Type at least 3 characters"),
});
export type GeocodeSearchQuery = z.infer<typeof geocodeSearchQuerySchema>;

// GET /geocode/reverse — a coordinate (e.g. from "Use my current location") -> a human label, so the UI can
// show something readable instead of raw numbers. Best-effort: see GeocodeResultDto's note on `label`.
export const geocodeReverseQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});
export type GeocodeReverseQuery = z.infer<typeof geocodeReverseQuerySchema>;

export interface GeocodeResultDto {
  label: string;
  lat: number;
  lng: number;
}
