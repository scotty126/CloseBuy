"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Crosshair, MapPin } from "lucide-react";
import { ThemeToggle } from "@closebuy/ui";
import type { GeocodeResultDto } from "@closebuy/types";
import { geocodeApi } from "@/lib/api";
import { AddressSearch } from "@/components/AddressSearch";
import { getDeliveryLocation, setDeliveryLocation } from "@/lib/deliveryLocation";

/**
 * "Where should we deliver?" — set once, reused at checkout. Launch is
 * Riverpark only (brief §2a), so the "areas we deliver to" list is that one
 * real area, not a picker with places that don't exist. Search results are
 * already scoped server-side to the live service area, so anything chosen here
 * is deliverable; checkout re-validates regardless.
 */
export default function LocationPage() {
  const router = useRouter();
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [label, setLabel] = useState<string | null>(null);
  const [landmark, setLandmark] = useState("");
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const saved = getDeliveryLocation();
    if (saved) {
      setLat(saved.lat);
      setLng(saved.lng);
      setLabel(saved.label);
      setLandmark(saved.landmark);
    }
  }, []);

  function onSelect(result: GeocodeResultDto) {
    setLat(result.lat);
    setLng(result.lng);
    setLabel(result.label);
    setError(null);
  }

  function useGps() {
    setError(null);
    if (!navigator.geolocation) {
      setError("Your browser doesn't support location — search for your street instead.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setLat(latitude);
        setLng(longitude);
        setLabel(null);
        setLocating(false);
        geocodeApi
          .reverse(latitude, longitude)
          .then((res) => setLabel(res.label))
          .catch(() => {}); // best effort — the pin is still set without a name
      },
      () => {
        setError("Couldn't get your location — check permissions, or search for your street instead.");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  function confirm() {
    if (lat === null || lng === null) return;
    setDeliveryLocation({ lat, lng, label, landmark: landmark.trim() });
    router.push("/");
  }

  const hasPin = lat !== null && lng !== null;
  const where = label?.split(",")[0] ?? "Riverpark";

  return (
    <div className="flex min-h-screen flex-col">
      <div className="relative h-[300px] shrink-0 overflow-hidden bg-[#EFE6DC] dark:bg-[#132B23]">
        {/* The canvas's decorative street map. It is an illustration, not a live map — nothing here claims a position. */}
        <svg width="100%" height="100%" viewBox="0 0 390 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true" className="absolute inset-0">
          <g className="stroke-white dark:stroke-[#1F3D32]" strokeWidth="14" strokeLinecap="round" fill="none">
            <path d="M-20 80 L410 60" />
            <path d="M-20 220 L410 240" />
            <path d="M110 -20 L130 320" />
            <path d="M290 -20 L270 320" />
          </g>
          <g className="stroke-white dark:stroke-[#1F3D32]" strokeWidth="6" fill="none">
            <path d="M-20 150 L410 160" />
            <path d="M200 -20 L195 320" />
          </g>
          <circle cx="195" cy="150" r="70" fill="#FF5A19" opacity="0.12" />
          <circle cx="195" cy="150" r="40" fill="#FF5A19" opacity="0.18" />
        </svg>
        {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset */}
        <img src="/logo-mark.png" alt="" className="absolute left-[172px] top-[112px] h-12 w-[46px] object-contain" />
        <span className="absolute left-[186px] top-[160px] h-2 w-[18px] rounded-[50%] bg-[#10231C] opacity-25" aria-hidden="true" />
        <div className="absolute inset-x-4 top-[18px] flex justify-between">
          <button
            type="button"
            onClick={() => (window.history.length > 1 ? router.back() : router.push("/"))}
            aria-label="Back"
            className="flex h-11 w-11 items-center justify-center rounded-[14px] bg-card text-ink"
          >
            <ArrowLeft size={18} strokeWidth={2.2} />
          </button>
          <ThemeToggle />
        </div>
      </div>

      <div className="relative -mt-7 flex flex-1 flex-col gap-3.5 rounded-t-[28px] bg-surface px-[18px] pb-4 pt-[22px]">
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-ink">Where should we deliver?</h1>

        <AddressSearch onSelect={onSelect} pill />

        <button
          type="button"
          onClick={useGps}
          disabled={locating}
          className={`flex min-h-[52px] items-center gap-3 rounded-2xl px-3.5 text-[15px] font-bold transition-colors disabled:opacity-70 ${
            hasPin && !label ? "bg-primary text-[#FFF7F1]" : "bg-raised text-ink"
          }`}
        >
          <Crosshair size={20} strokeWidth={2} aria-hidden="true" />
          {locating ? "Locating…" : hasPin && !label ? "Using your current location" : "Use my current location"}
        </button>
        {error && <p className="text-xs text-danger">{error}</p>}

        {hasPin && label && (
          <p className="flex items-start gap-2 rounded-2xl bg-card p-3 text-sm text-ink">
            <MapPin size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
            {label}
          </p>
        )}

        <span className="font-mono text-xs font-bold uppercase tracking-[0.08em] text-muted">Areas we deliver to</span>
        <div className="flex min-h-[60px] items-center gap-3 rounded-2xl bg-card px-3.5 py-2.5 shadow-[inset_0_0_0_2px_#FF5A19]">
          <span className="h-5 w-5 shrink-0 rounded-full border-[6px] border-accent" />
          <span className="flex flex-col gap-0.5">
            <span className="text-[15px] font-bold text-ink">Riverpark</span>
            <span className="text-xs text-muted">The only area we deliver to right now</span>
          </span>
        </div>

        <label className="flex flex-col gap-1.5 text-[13px] font-bold text-ink">
          House number &amp; landmark
          <input
            type="text"
            value={landmark}
            onChange={(e) => setLandmark(e.target.value)}
            placeholder="e.g. Block 4, opposite the mosque"
            className="h-[50px] rounded-[14px] border-0 bg-card px-3.5 text-[15px] font-normal text-ink outline-none placeholder:text-muted/60 focus:shadow-[inset_0_0_0_2px_#FF5A19]"
          />
        </label>

        <div className="mt-auto pt-2">
          <button
            type="button"
            onClick={confirm}
            disabled={!hasPin}
            className="flex h-[58px] w-full items-center justify-center rounded-xl bg-accent text-base font-bold text-night transition-transform active:scale-[0.98] disabled:opacity-50"
          >
            {hasPin ? `Deliver to ${where}` : "Pick a spot to continue"}
          </button>
        </div>
      </div>
    </div>
  );
}
