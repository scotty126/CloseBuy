"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bell, ChevronDown } from "lucide-react";
import { useAuthSession, ThemeToggle } from "@closebuy/ui";
import { notificationsApi } from "@/lib/api";
import { getDeliveryLocation } from "@/lib/deliveryLocation";

/**
 * Home's top bar, to the canvas's measurements: wordmark, the delivery area,
 * bell, theme. The area pill opens /location. There is no Sign-in button here
 * (sign-in lives under "Me"), and the bell dot only shows when something is unread.
 */
export function AppHeader() {
  const { session, isLoaded } = useAuthSession();
  const [hasUnread, setHasUnread] = useState(false);
  const [place, setPlace] = useState("Riverpark");

  useEffect(() => {
    const saved = getDeliveryLocation();
    if (saved?.label) setPlace(saved.label.split(",")[0] ?? "Riverpark");
  }, []);

  useEffect(() => {
    if (!isLoaded || !session) return;
    notificationsApi
      .list()
      .then((res) => setHasUnread(res.notifications.some((n) => n.readAt === null)))
      .catch(() => {});
  }, [isLoaded, session]);

  return (
    <header className="flex items-center gap-2 border-b border-line px-4 pb-2.5 pt-3.5 lg:hidden">
      <Link href="/" className="flex flex-1 items-center gap-[7px]">
        {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset */}
        <img src="/logo-mark.png" alt="" className="h-[25px] w-6" />
        <span className="font-display text-lg font-extrabold tracking-[-0.02em] text-accent">CloseBuy</span>
      </Link>
      <Link
        href="/location"
        aria-label="Change delivery location"
        className="flex h-8 max-w-[42%] items-center gap-1.5 rounded-lg px-2.5 font-mono text-[11px] uppercase shadow-[inset_0_0_0_1px_rgb(var(--c-line))]"
      >
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#22C55E]" aria-hidden="true" />
        <span className="truncate">{place}</span>
        <ChevronDown size={10} strokeWidth={2.4} className="shrink-0" aria-hidden="true" />
      </Link>
      <Link href="/notifications" aria-label="Notifications" className="relative flex h-11 w-10 items-center justify-center text-ink">
        <Bell size={17} strokeWidth={1.8} />
        {hasUnread && <span className="absolute right-2.5 top-[11px] h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />}
      </Link>
      <ThemeToggle plain size={17} />
    </header>
  );
}
