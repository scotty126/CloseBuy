"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { ONBOARDED_KEY } from "@/lib/onboarding";


// Copy and colours from the "CloseBuy Redesign" canvas (BOnboard). The payment
// slide says what CloseBuy really offers: pay now (card or transfer) or cash
// on delivery.
const SLIDES = [
  {
    title: "Your street, in your pocket.",
    body: "Buy from the provision shops, kitchens and pharmacies already around you — the sellers you know.",
    icon: "M3 11 12 4l9 7v9H3v-9ZM9 20v-6h6v6",
    bg: "#255748",
    fg: "#FFF7F1",
  },
  {
    title: "Delivered in minutes, not days.",
    body: "Your order is packed next door, so a rider gets it to you fast. Follow every step as it happens.",
    icon: "M3 7h11v9H3zM14 10h4l3 3v3h-7M7 18a2 2 0 1 0 0 .1M17 18a2 2 0 1 0 0 .1",
    bg: "#FF5A19",
    fg: "#10231C",
  },
  {
    title: "Pay your way, no wahala.",
    body: "Pay on delivery with cash, or pay now by card or bank transfer. Your money stays in the neighbourhood.",
    icon: "M3 6h18v13H3zM3 10h18M7 15h3",
    bg: "#FFF7F1",
    fg: "#10231C",
  },
];

const ORBIT = [
  { icon: "M3 9h18l-2 11H5L3 9ZM8 9l4-6 4 6", pos: [20, 40] },
  { icon: "M9 3h6v6h6v6h-6v6H9v-6H3V9h6V3Z", pos: [226, 30] },
  { icon: "M6 3h12l-2 18H8L6 3ZM7 8h10", pos: [236, 220] },
  { icon: "M3 11h18a9 9 0 0 1-18 0Z", pos: [14, 214] },
];
const TILES = ["#FFE3D3", "#DCEBE4", "#FFF0C9", "#E3E8F7"];

/**
 * First-run intro. Skippable at every step, never shown again once finished or
 * skipped (the flag lives in this browser only — there's no account to hang it
 * on for a guest, and an intro is not worth a server round-trip).
 */
export default function WelcomePage() {
  const router = useRouter();
  const [i, setI] = useState(0);
  const slide = SLIDES[i]!;
  const onOrange = i === 1;
  const onCream = i === 2;
  const last = i === SLIDES.length - 1;

  useEffect(() => {
    // Paint the browser chrome / overscroll in the slide colour too.
    const prev = document.body.style.backgroundColor;
    document.body.style.backgroundColor = slide.bg;
    return () => {
      document.body.style.backgroundColor = prev;
    };
  }, [slide.bg]);

  function finish() {
    try {
      window.localStorage.setItem(ONBOARDED_KEY, "1");
    } catch {
      // Private mode — they may see the intro again next visit; harmless.
    }
    router.replace("/");
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-hidden transition-colors duration-500" style={{ background: slide.bg, color: slide.fg }}>
      <div className="mx-auto flex w-full max-w-lg items-center justify-between px-5 pt-5">
        <span className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset */}
          <img src={onOrange ? "/logo-mark-white.png" : "/logo-mark.png"} alt="" className="h-[30px] w-7 object-contain" />
          <span className="font-display text-xl tracking-[-0.02em]" style={{ color: onOrange ? "#FFFFFF" : "#FF5A19" }}>
            CloseBuy
          </span>
        </span>
        <button type="button" onClick={finish} className="px-1 py-3 text-sm font-bold">
          Skip
        </button>
      </div>

      <div className="relative mx-auto flex w-full max-w-lg flex-1 items-center justify-center">
        <div className="relative h-[300px] w-[300px]">
          <svg width="300" height="300" viewBox="0 0 300 300" aria-hidden="true" className="absolute inset-0">
            <circle cx="150" cy="150" r="140" fill="none" stroke={onCream ? "#E4D6CB" : "rgba(255,247,241,0.35)"} strokeWidth="2" strokeDasharray="4 10" />
            <circle cx="150" cy="150" r="96" fill="none" stroke={onCream ? "#E4D6CB" : "rgba(255,247,241,0.35)"} strokeWidth="2" strokeDasharray="4 10" />
            <circle cx="150" cy="150" r="54" fill={onOrange ? "#FFF7F1" : "#FF5A19"} />
          </svg>
          <svg
            width="64"
            height="64"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#10231C"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="absolute left-[118px] top-[118px]"
          >
            <path d={slide.icon} />
          </svg>
          {ORBIT.map((o, k) => (
            <span
              key={k}
              className="absolute flex h-[52px] w-[52px] items-center justify-center rounded-2xl transition-transform duration-500"
              style={{ left: o.pos[0], top: o.pos[1], background: TILES[(k + i) % 4], transform: `rotate(${i * 12 - 6 + k * 4}deg)` }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#10231C" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d={o.icon} />
              </svg>
            </span>
          ))}
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-lg flex-col gap-[22px] px-6 pb-7">
        <div className="flex gap-1.5">
          {SLIDES.map((_, k) => (
            <button key={k} type="button" onClick={() => setI(k)} aria-label={`Show step ${k + 1}`} className="flex h-11 items-center">
              <span
                className="block h-2 rounded-full transition-all duration-300"
                style={{
                  width: k === i ? 28 : 8,
                  background: k === i ? (onCream ? "#FF5A19" : slide.fg) : onCream ? "#E4D6CB" : "rgba(255,247,241,0.4)",
                }}
              />
            </button>
          ))}
        </div>
        <h1 className="text-[34px] font-semibold leading-[1.05] tracking-[-0.03em]">{slide.title}</h1>
        <p className="text-base leading-relaxed opacity-85">{slide.body}</p>
        <button
          type="button"
          onClick={() => (last ? finish() : setI((v) => Math.min(SLIDES.length - 1, v + 1)))}
          className="flex h-[58px] items-center justify-center gap-2 rounded-xl text-base font-bold transition-transform active:scale-[0.98]"
          style={{ background: last ? "#FF5A19" : onCream ? "#255748" : "#FFF7F1", color: last ? "#10231C" : onCream ? "#FFF7F1" : "#10231C" }}
        >
          {last ? "Get started" : "Next"} <ArrowRight size={16} strokeWidth={2.4} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
