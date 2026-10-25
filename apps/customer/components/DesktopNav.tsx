"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Search, ShoppingBag, User } from "lucide-react";
import { ThemeToggle } from "@closebuy/ui";
import { useCart } from "@/lib/cart";

const HIDDEN_ON = ["/login", "/register", "/forgot-password", "/reset-password", "/verify-email", "/oauth-complete", "/welcome"];

const LINKS = [
  { href: "/", label: "Shop" },
  { href: "/search?sale=1", label: "Deals", match: "/search" },
  { href: "/orders", label: "Orders" },
  { href: "/saved", label: "Saved" },
];

/** The desktop (lg+) top bar from the redesign — the phone tab bar and Home header are `lg:hidden`, this is their replacement. */
export function DesktopNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { itemCount } = useCart();
  const [q, setQ] = useState("");

  if (HIDDEN_ON.some((p) => pathname.startsWith(p))) return null;

  const isActive = (l: (typeof LINKS)[number]) => (l.href === "/" ? pathname === "/" : pathname.startsWith(l.match ?? l.href));

  return (
    <header className="sticky top-0 z-30 hidden border-b border-line bg-surface/85 backdrop-blur-xl lg:block">
      <div className="mx-auto flex min-h-16 max-w-[1280px] items-center gap-5 px-10 py-2.5">
        <Link href="/" className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset */}
          <img src="/logo-mark.png" alt="" className="object-contain h-[27px] w-[26px]" />
          <span className="font-display text-xl tracking-[-0.02em] text-accent">CloseBuy</span>
        </Link>

        <nav aria-label="Primary" className="flex gap-0.5 rounded-[11px] p-[3px] shadow-[inset_0_0_0_1px_rgb(var(--c-line))]">
          {LINKS.map((l) => (
            <Link
              key={l.label}
              href={l.href}
              aria-current={isActive(l) ? "page" : undefined}
              className={`flex h-[38px] items-center rounded-lg px-3.5 text-[13px] transition-colors ${isActive(l) ? "bg-raised font-medium text-ink" : "text-muted hover:text-ink"}`}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <span className="flex-1" />

        <form
          onSubmit={(e) => {
            e.preventDefault();
            router.push(q.trim() ? `/search?q=${encodeURIComponent(q.trim())}` : "/search");
          }}
          className="flex h-10 w-[300px] items-center gap-2 rounded-[10px] bg-card pl-3 pr-1.5 shadow-[inset_0_0_0_1px_rgb(var(--c-line))]"
        >
          <Search size={15} strokeWidth={2} className="shrink-0 text-muted" aria-hidden="true" />
          <label className="sr-only" htmlFor="desktop-search">
            Search
          </label>
          <input
            id="desktop-search"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search products, shops…"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-muted"
          />
        </form>

        <ThemeToggle className="!bg-transparent !shadow-none" />
        <Link href="/account" aria-label="Account" className="flex h-11 w-11 items-center justify-center rounded-[10px] text-ink hover:bg-raised">
          <User size={18} strokeWidth={1.8} />
        </Link>
        <Link href="/cart" className="flex h-10 items-center gap-2 rounded-[10px] bg-ink px-3.5 text-[13px] font-medium text-surface">
          <ShoppingBag size={15} aria-hidden="true" />
          Bag
          {itemCount > 0 && <span className="rounded-[5px] bg-accent px-1.5 py-0.5 font-mono text-[11px] text-night">{itemCount}</span>}
        </Link>
      </div>
    </header>
  );
}
