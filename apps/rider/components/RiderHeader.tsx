"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle, useAuthSession } from "@closebuy/ui";

const CHROME_LESS_ROUTES = ["/login", "/oauth-complete"];

const TABS = [
  { href: "/", label: "Jobs", icon: "M3 7h11v9H3zM14 10h4l3 3v3h-7M7 18a2 2 0 1 0 0 .1M17 18a2 2 0 1 0 0 .1" },
  { href: "/earnings", label: "Earnings", icon: "M3 6h18v12H3zM3 10h18M7 15h4" },
  { href: "/notifications", label: "Alerts", icon: "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0" },
];

/**
 * Signed-out screens aren't part of the authenticated app chrome — a
 * Notifications/Earnings header on the login screen implied a session that
 * doesn't exist yet, same reasoning as AdminSidebar/VendorSidebar.
 *
 * Still single-task by design (screens-navigation.md §3): a slim top bar and a
 * three-item floating tab bar — Jobs is always one tap away mid-delivery.
 */
export function RiderHeader() {
  const pathname = usePathname();
  const { clear } = useAuthSession();
  if (CHROME_LESS_ROUTES.includes(pathname)) return null;

  return (
    <>
      <header className="sticky top-0 z-30 mx-auto flex max-w-lg items-center gap-2 border-b border-line bg-surface/90 px-3.5 py-2 backdrop-blur-md">
        {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset */}
        <img src="/logo-mark.png" alt="" className="object-contain h-[23px] w-[22px]" />
        <span className="rounded-[5px] px-1.5 py-0.5 font-mono text-[10px] text-muted shadow-[inset_0_0_0_1px_rgb(var(--c-line))]">RIDER</span>
        <span className="flex-1" />
        <ThemeToggle className="!h-10 !w-10 !bg-transparent !shadow-none" />
        <button
          type="button"
          onClick={() => {
            clear();
            window.location.href = "/login";
          }}
          aria-label="Log out"
          className="flex h-10 w-10 items-center justify-center text-muted"
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
          </svg>
        </button>
      </header>

      <nav
        aria-label="Main"
        className="fixed inset-x-3.5 bottom-[calc(0.75rem+env(safe-area-inset-bottom,0px))] z-30 mx-auto flex h-[60px] max-w-[26rem] items-center justify-around rounded-[18px] bg-card/90 shadow-[0_0_0_1px_rgb(var(--c-line)),0_12px_30px_rgba(14,31,25,0.14)] backdrop-blur-xl"
      >
        {TABS.map((t) => {
          const active = t.href === "/" ? pathname === "/" : pathname === t.href || pathname.startsWith(`${t.href}/`);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={`relative flex h-[52px] w-[84px] flex-col items-center justify-center gap-[3px] font-mono text-[10px] uppercase transition-colors active:scale-95 ${active ? "text-ink" : "text-muted"}`}
            >
              <span className={`absolute -top-1 h-[3px] rounded-sm bg-accent transition-all duration-300 ${active ? "w-[18px] opacity-100" : "w-0 opacity-0"}`} aria-hidden="true" />
              <span className={active ? "text-accent" : ""}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d={t.icon} />
                </svg>
              </span>
              {t.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
