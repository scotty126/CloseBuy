"use client";

import { APIProvider, Map, Marker } from "@vis.gl/react-google-maps";

const RIVERPARK_CENTER = { lat: 8.9797, lng: 7.339 }; // roughly the middle of the real service-area polygon (prisma/seed.ts)

/**
 * Visual confirmation + fine-tuning for the delivery pin — geolocation
 * (checkout/page.tsx) gets you close, but GPS can be off by tens of
 * metres, especially indoors; dragging the marker or tapping elsewhere
 * on the map corrects it precisely. This is additive, not a replacement
 * — the manual lat/lng fields and server-side service-area validation
 * (US-C-05) both still work exactly as before if this never loads
 * (missing/invalid key, network blip, etc.).
 *
 * Uses the classic `Marker`, not `AdvancedMarker` — deliberately: the
 * advanced one needs a Map ID configured in Cloud Console first, which
 * is one more setup step for zero visible benefit here (no custom pin
 * styling needed).
 */
export function DeliveryLocationMap({
  lat,
  lng,
  onChange,
}: {
  lat: number | null;
  lng: number | null;
  onChange: (lat: number, lng: number) => void;
}) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null; // not configured in this environment — the text-only flow above still works fully

  const center = lat !== null && lng !== null ? { lat, lng } : RIVERPARK_CENTER;

  return (
    <div className="h-48 w-full overflow-hidden rounded-lg border border-gray-200">
      <APIProvider apiKey={apiKey}>
        <Map
          center={center}
          defaultZoom={16}
          gestureHandling="greedy"
          disableDefaultUI
          onClick={(e) => {
            if (e.detail.latLng) onChange(e.detail.latLng.lat, e.detail.latLng.lng);
          }}
        >
          {lat !== null && lng !== null && (
            <Marker
              position={{ lat, lng }}
              draggable
              onDragEnd={(e) => {
                const pos = e.latLng;
                if (pos) onChange(pos.lat(), pos.lng());
              }}
            />
          )}
        </Map>
      </APIProvider>
    </div>
  );
}
