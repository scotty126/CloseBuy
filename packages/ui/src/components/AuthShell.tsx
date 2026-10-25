"use client";

import type { ReactNode } from "react";

type AuthApp = "customer" | "vendor" | "rider" | "admin";

// The side panel's copy on desktop, per app (from the "CloseBuy Redesign" canvas).
const APP_COPY: Record<AuthApp, { tag: string; short: string | null; headline: string; body: string }> = {
  customer: {
    tag: "SHOP",
    short: null,
    headline: "Your street's shops, at your door.",
    body: "Order from local sellers nearby and follow every delivery to your door.",
  },
  vendor: {
    tag: "SELLER PORTAL",
    short: "SELLER",
    headline: "Run your shop. We bring the buyers.",
    body: "Manage orders, products, opening hours and payouts in one place.",
  },
  rider: {
    tag: "RIDER APP",
    short: "RIDER",
    headline: "Ride your neighbourhood. Earn per drop.",
    body: "Go on duty, accept nearby jobs and keep track of your cash and earnings.",
  },
  admin: {
    tag: "ADMIN CONSOLE",
    short: "ADMIN",
    headline: "Keep the marketplace healthy.",
    body: "Orders, disputes, partners, payouts and platform config.",
  },
};

/**
 * The one frame every sign-in / register / reset / verify / OAuth-landing
 * screen sits in: a phone-first column (logo, mono route label, title,
 * subtitle, the form) that grows a green brand panel beside it from `lg` up.
 * Pages keep their own form logic and just pass it in as children.
 */
export function AuthShell({
  app,
  route,
  title,
  subtitle,
  children,
}: {
  app: AuthApp;
  /** The route this screen lives at, shown as a small mono label, e.g. "login". */
  route: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const copy = APP_COPY[app];
  const prefix = app === "customer" ? "/ " : `${app} / `;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-surface lg:flex">
      <aside className="relative hidden flex-1 basis-[480px] flex-col justify-between overflow-hidden bg-[#255748] p-12 text-[#F3EEE9] lg:flex">
        <svg width="100%" height="100%" aria-hidden="true" className="absolute inset-0 opacity-[0.14]">
          <defs>
            <pattern id="auth-grid" width="32" height="32" patternUnits="userSpaceOnUse">
              <path d="M32 0H0V32" fill="none" stroke="#F3EEE9" strokeWidth="0.7" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#auth-grid)" />
        </svg>
        <span className="relative flex items-center gap-2.5 font-display text-[28px] tracking-[-0.02em] text-white">
          {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset */}
          <img src="/logo-mark.png" alt="" className="object-contain h-9 w-9" />
          CloseBuy
        </span>
        <div className="relative flex max-w-[420px] flex-col gap-3.5">
          <span className="self-start rounded-[7px] bg-white/10 px-2 py-1 font-mono text-[11px] uppercase">{copy.tag}</span>
          <span className="text-[40px] font-semibold leading-[1.05] tracking-[-0.04em]">{copy.headline}</span>
          <span className="text-[15px] leading-relaxed opacity-85">{copy.body}</span>
        </div>
      </aside>

      <main className="relative flex min-h-full flex-1 flex-col gap-9 px-[30px] pb-10 pt-5 lg:items-center lg:justify-center lg:gap-6 lg:px-6 lg:py-10">
        <div className="flex items-center gap-2 lg:hidden">
          {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset */}
          <img src="/logo-mark.png" alt="" className="h-[27px] w-[26px] object-contain" />
          <span className="font-display text-xl tracking-[-0.02em] text-accent">CloseBuy</span>
          {copy.short && (
            <span className="rounded-[5px] px-1.5 py-0.5 font-mono text-[10px] text-muted shadow-[inset_0_0_0_1px_rgb(var(--c-line))]">{copy.short}</span>
          )}
        </div>

        <div
          className="flex w-full max-w-[380px] flex-col gap-[18px]
            [&_form]:flex [&_form]:flex-col [&_form]:gap-3
            [&_input:not([type=checkbox])]:h-11 [&_input:not([type=checkbox])]:rounded-[10px] [&_input:not([type=checkbox])]:border-0 [&_input:not([type=checkbox])]:bg-card [&_input:not([type=checkbox])]:px-3 [&_input:not([type=checkbox])]:text-sm [&_input:not([type=checkbox])]:shadow-[inset_0_0_0_1px_rgb(var(--c-line))] [&_input:not([type=checkbox])]:ring-0 [&_input:not([type=checkbox])]:focus:shadow-[inset_0_0_0_2px_#FF5A19]
            [&_label]:text-[13px] [&_label]:font-medium
            [&_button[type=submit]]:gap-1.5 [&_button[type=submit]]:h-[46px] [&_button[type=submit]]:rounded-[11px] [&_button[type=submit]]:text-sm [&_button[type=submit]]:font-semibold [&_button[type=submit]]:shadow-none [&_button[type=submit]]:text-[#0E1F19]"
        >
          <div className="flex flex-col gap-1.5">
            <span className="font-mono text-[11px] text-muted">
              {prefix}
              {route}
            </span>
            <h1 className="text-[28px] font-semibold tracking-[-0.035em] text-ink">{title}</h1>
            {subtitle && <p className="text-sm leading-[1.55] text-muted">{subtitle}</p>}
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
