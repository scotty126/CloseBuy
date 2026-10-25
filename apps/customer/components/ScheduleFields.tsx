"use client";

import { useEffect, useState } from "react";
import { useCart } from "@/lib/cart";
import { catalogApi } from "@/lib/api";
import { formatTime } from "@/lib/formatHours";

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/**
 * US-C-05a — "Schedule for later offers a date and a time slot within the
 * vendor's stated hours." Mirrors the server-side check in
 * order/service.ts's isWithinVendorHours — this is the "shown before
 * payment" half; the server check is the real authority regardless.
 */
export function isWithinVendorHours(iso: string, openingHours: Record<string, [string, string]> | null | undefined): boolean {
  if (!openingHours) return true; // nothing real to constrain against
  const d = new Date(iso);
  const range = openingHours[DAY_KEYS[d.getDay()]!];
  if (!range) return false;
  const minutesOfDay = d.getHours() * 60 + d.getMinutes();
  const toMinutes = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };
  return minutesOfDay >= toMinutes(range[0]) && minutesOfDay <= toMinutes(range[1]);
}

const seg = (on: boolean) =>
  `flex h-[56px] flex-1 flex-col items-start justify-center gap-0.5 rounded-[14px] px-2.5 text-left text-[13px] transition-colors ${on ? "bg-primary text-[#FFF7F1]" : "bg-raised text-ink"}`;

/**
 * Delivery-vs-pickup and now-vs-later, in the shape of the canvas's Delivery card
 * slots (a row of tinted buttons). `onValidityChange(false)` while a scheduled time is
 * missing or outside the shop's hours, so checkout can hold the Place-order button.
 */
export function ScheduleFields({ onValidityChange }: { onValidityChange?: (ok: boolean) => void }) {
  const { cart, setFulfilmentType, setScheduledFor } = useCart();
  const [mode, setMode] = useState<"asap" | "later">(cart.scheduledFor ? "later" : "asap");
  const [openingHours, setOpeningHours] = useState<Record<string, [string, string]> | null | undefined>(undefined);

  useEffect(() => {
    if (mode !== "later" || !cart.vendor) return;
    catalogApi
      .getVendor(cart.vendor.id)
      .then((res) => setOpeningHours(res.vendor.openingHours))
      .catch(() => {}); // best effort — checkout still enforces it server-side
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, cart.vendor?.id]);

  const outside = mode === "later" && Boolean(cart.scheduledFor) && openingHours != null && !isWithinVendorHours(cart.scheduledFor!, openingHours);
  const ok = mode === "asap" || (Boolean(cart.scheduledFor) && !outside);
  useEffect(() => {
    onValidityChange?.(ok);
  }, [ok, onValidityChange]);

  if (!cart.vendor) return null;
  const minDateTime = new Date(Date.now() + 15 * 60 * 1000).toISOString().slice(0, 16); // at least 15 min out

  return (
    <div className="flex flex-col gap-2.5">
      {cart.vendor.supportsPickup && (
        <div className="flex gap-2" role="group" aria-label="Delivery or pickup">
          <button type="button" aria-pressed={cart.fulfilmentType === "delivery"} onClick={() => setFulfilmentType("delivery")} className={seg(cart.fulfilmentType === "delivery")}>
            <span className="font-bold">Delivery</span>
            <span className="text-xs opacity-80">To your door</span>
          </button>
          <button type="button" aria-pressed={cart.fulfilmentType === "pickup"} onClick={() => setFulfilmentType("pickup")} className={seg(cart.fulfilmentType === "pickup")}>
            <span className="font-bold">Pickup</span>
            <span className="text-xs opacity-80">Collect in person</span>
          </button>
        </div>
      )}
      <div className="flex gap-2" role="group" aria-label="When">
        <button
          type="button"
          aria-pressed={mode === "asap"}
          onClick={() => {
            setMode("asap");
            setScheduledFor(null);
          }}
          className={seg(mode === "asap")}
        >
          <span className="font-bold">Now</span>
          <span className="text-xs opacity-80">As soon as possible</span>
        </button>
        <button type="button" aria-pressed={mode === "later"} onClick={() => setMode("later")} className={seg(mode === "later")}>
          <span className="font-bold">Later</span>
          <span className="text-xs opacity-80">Pick a time</span>
        </button>
      </div>
      {mode === "later" && (
        <>
          <label className="flex items-center rounded-[14px] bg-raised px-3.5">
            <span className="sr-only">Scheduled time</span>
            <input
              type="datetime-local"
              min={minDateTime}
              value={cart.scheduledFor ? cart.scheduledFor.slice(0, 16) : ""}
              onChange={(e) => setScheduledFor(e.target.value ? new Date(e.target.value).toISOString() : null)}
              className="h-12 w-full bg-transparent text-sm text-ink outline-none"
            />
          </label>
          {outside && openingHours && (
            <p className="text-xs font-medium text-danger">
              {(() => {
                const range = openingHours[DAY_KEYS[new Date(cart.scheduledFor!).getDay()]!];
                return range
                  ? `${cart.vendor!.businessName} is only open ${formatTime(range[0])} – ${formatTime(range[1])} that day.`
                  : `${cart.vendor!.businessName} doesn't open that day.`;
              })()}
            </p>
          )}
        </>
      )}
    </div>
  );
}
