"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Home · Search · Orders · Account — 4 tabs, not DoorDash's 5.
// screens-navigation.md §1: pickup is a per-vendor toggle, not a browse
// mode, so it doesn't get its own tab.
const TABS = [
  { href: "/", label: "Home" },
  { href: "/search", label: "Search" },
  { href: "/orders", label: "Orders" },
  { href: "/account", label: "Account" },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 flex border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom,0px)]">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`flex-1 py-3 text-center text-xs font-medium ${
              active ? "text-primary" : "text-muted"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
