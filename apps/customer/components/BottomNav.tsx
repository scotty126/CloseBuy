"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Search, ShoppingBag, ClipboardList, User } from "lucide-react";
import { useCart } from "@/lib/cart";

// The canvas has two tab bars. Home's is five labelled tabs (Home · Search · Bag · Orders · Me) in mono caps; the
// chunkier screens (Orders, Me) use four — Home · Search · Orders · Me — as bare icons with the current one
// expanded into a green pill that carries its label. Every other screen is a drill-in with its own back arrow, so it
// has no tab bar at all.
const TABS_A = [
  { href: "/", label: "Home", icon: Home },
  { href: "/search", label: "Search", icon: Search },
  { href: "/cart", label: "Bag", icon: ShoppingBag },
  { href: "/orders", label: "Orders", icon: ClipboardList },
  { href: "/account", label: "Me", icon: User },
];
const TABS_B = [
  { href: "/", label: "Home", icon: Home },
  { href: "/search", label: "Search", icon: Search },
  { href: "/orders", label: "Orders", icon: ClipboardList },
  { href: "/account", label: "Account", icon: User },
];

export function BottomNav() {
  const pathname = usePathname();
  const { itemCount } = useCart();

  if (pathname === "/") {
    return (
      <nav
        aria-label="Main"
        className="fixed inset-x-4 bottom-[calc(0.875rem+env(safe-area-inset-bottom,0px))] z-20 mx-auto flex h-[60px] max-w-[30rem] items-center justify-around rounded-[18px] bg-nav/[0.86] shadow-[0_0_0_1px_rgb(var(--c-line)),0_12px_30px_rgba(14,31,25,0.14)] backdrop-blur-[16px] lg:hidden"
      >
        {TABS_A.map((tab) => {
          const active = pathname === tab.href;
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={`relative flex h-[52px] w-[70px] flex-col items-center justify-center gap-[3px] font-mono text-[10px] uppercase transition-colors duration-200 active:scale-95 ${active ? "text-ink" : "text-muted"}`}
            >
              {active && <span className="absolute -top-1 h-[3px] w-[18px] rounded-sm bg-accent" aria-hidden="true" />}
              <Icon size={20} strokeWidth={1.9} className={active ? "text-accent" : ""} />
              {tab.label}
              {tab.href === "/cart" && itemCount > 0 && (
                <span className="absolute right-4 top-1 flex h-4 min-w-4 items-center justify-center rounded-lg bg-accent px-1 text-[10px] font-semibold text-[#0E1F19]">{itemCount}</span>
              )}
            </Link>
          );
        })}
      </nav>
    );
  }

  if (pathname !== "/orders" && pathname !== "/account") return null;

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-4 bottom-[calc(0.875rem+env(safe-area-inset-bottom,0px))] z-20 mx-auto flex h-[60px] max-w-[30rem] items-center justify-around rounded-[18px] bg-card shadow-[0_0_0_1px_rgba(14,31,25,0.08),0_12px_30px_rgba(14,31,25,0.1)] lg:hidden"
    >
      {TABS_B.map((tab) => {
        const active = pathname === tab.href;
        const Icon = tab.icon;
        return active ? (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current="page"
            className="flex h-11 items-center gap-1.5 rounded-full bg-primary px-3.5 text-[13px] font-bold text-[#FFF7F1]"
          >
            <Icon size={18} strokeWidth={2} />
            {tab.label}
          </Link>
        ) : (
          <Link key={tab.href} href={tab.href} aria-label={tab.label} className="flex h-11 w-11 items-center justify-center text-muted transition-transform active:scale-90">
            <Icon size={20} strokeWidth={2} />
          </Link>
        );
      })}
    </nav>
  );
}
