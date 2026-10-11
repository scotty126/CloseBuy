"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Search, ClipboardList, User } from "lucide-react";

// Home · Search · Orders · Account — 4 tabs, not DoorDash's 5.
// screens-navigation.md §1: pickup is a per-vendor toggle, not a browse
// mode, so it doesn't get its own tab.
const TABS = [
  { href: "/", label: "Home", icon: Home },
  { href: "/search", label: "Search", icon: Search },
  { href: "/orders", label: "Orders", icon: ClipboardList },
  { href: "/account", label: "Account", icon: User },
];

export function BottomNav() {
  const pathname = usePathname();
  const activeIndex = Math.max(
    0,
    TABS.findIndex((tab) => tab.href === pathname),
  );

  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 mx-auto flex w-full max-w-lg border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom,0px)]">
      {/* A thin sliding indicator above the active tab — translateX in
          quarters of the nav's own width, one per tab, so it never needs to
          know pixel widths. */}
      <span
        className="pointer-events-none absolute left-0 top-0 h-0.5 w-1/4 rounded-full bg-primary transition-transform duration-300 ease-out"
        style={{ transform: `translateX(${activeIndex * 100}%)` }}
        aria-hidden="true"
      />
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        const Icon = tab.icon;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`relative flex flex-1 flex-col items-center gap-0.5 py-2.5 text-center text-[11px] font-medium transition-colors duration-200 active:scale-95 ${
              active ? "text-primary" : "text-muted"
            }`}
          >
            <Icon size={22} strokeWidth={active ? 2.5 : 2} className="transition-[stroke-width] duration-200" />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
