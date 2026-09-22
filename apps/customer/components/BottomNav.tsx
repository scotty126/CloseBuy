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

  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 mx-auto flex w-full max-w-lg border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom,0px)]">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        const Icon = tab.icon;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 text-center text-[11px] font-medium ${
              active ? "text-primary" : "text-muted"
            }`}
          >
            <Icon size={22} strokeWidth={active ? 2.5 : 2} />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
