"use client";

const STORAGE_KEY = "closebuy.guestOrders";
const MAX_REMEMBERED = 20; // enough for a genuinely active guest without the list growing forever

export interface GuestOrderRef {
  trackingToken: string;
  placedAt: string; // ISO — set locally at checkout time, just for sort order before each order's real data loads
}

/**
 * A guest has no account, so the server has nothing to list orders against
 * (US-C-06a) — but that doesn't mean the /orders tab should be a dead end
 * for them. This remembers the tracking tokens a guest checkout produced,
 * in *this browser only*, the same way the cart itself is client-side-only
 * (lib/cart.tsx). It's a same-device convenience, not account-level
 * history — a different device, a cleared browser, or private browsing
 * still has none of this, same as before. The tracking link is still the
 * durable answer to "how do I get back to this order"; this is additive.
 */
export function addGuestOrder(trackingToken: string) {
  if (typeof window === "undefined") return;
  try {
    const existing = getGuestOrders().filter((o) => o.trackingToken !== trackingToken);
    const next = [{ trackingToken, placedAt: new Date().toISOString() }, ...existing].slice(0, MAX_REMEMBERED);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private browsing / storage blocked — the order still exists server-side via its tracking link, just not remembered here.
  }
}

export function getGuestOrders(): GuestOrderRef[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
