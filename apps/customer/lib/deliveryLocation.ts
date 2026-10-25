const KEY = "closebuy.deliveryLocation";

/**
 * Where this browser last said it wants things delivered — chosen on /location
 * and used to prefill checkout's pin. A convenience only: checkout still sends
 * (and the server still validates against the service area) its own copy of
 * the pin, exactly as it does for a saved address. Guests have no account to
 * keep this on, so it lives in this browser.
 */
export interface SavedDeliveryLocation {
  lat: number;
  lng: number;
  label: string | null;
  landmark: string;
}

export function getDeliveryLocation(): SavedDeliveryLocation | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<SavedDeliveryLocation>;
    if (typeof v.lat !== "number" || typeof v.lng !== "number") return null;
    return { lat: v.lat, lng: v.lng, label: v.label ?? null, landmark: v.landmark ?? "" };
  } catch {
    return null;
  }
}

export function setDeliveryLocation(loc: SavedDeliveryLocation) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(loc));
  } catch {
    // Private mode — it just won't be remembered.
  }
}
