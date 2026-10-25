"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sidebar } from "@closebuy/ui";

// screens-navigation.md §2 — Orders is the default landing screen. Icon paths
// and short labels come from the redesign canvas (VApp).
const NAV = [
  { href: "/", label: "Order queue", short: "Queue", icon: "M4 4h16v4H4zM4 10h16v4H4zM4 16h10v4H4z" },
  { href: "/products", label: "Products", short: "Products", icon: "M21 8 12 3 3 8v8l9 5 9-5V8ZM3 8l9 5 9-5M12 13v8" },
  { href: "/earnings", label: "Earnings & payouts", short: "Earnings", icon: "M3 6h18v12H3zM3 10h18M7 15h4" },
  {
    href: "/settings",
    label: "Store settings",
    short: "Settings",
    icon: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z",
  },
  { href: "/notifications", label: "Notifications", short: "Alerts", icon: "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0" },
];

const CHROME_LESS_ROUTES = ["/login", "/oauth-complete"];

export function VendorSidebar() {
  const pathname = usePathname();
  // Signed-out screens aren't part of the authenticated app chrome — showing
  // every internal section name before someone's even signed in looked
  // unfinished and leaked the nav structure for no reason.
  if (CHROME_LESS_ROUTES.includes(pathname)) return null;
  // A detail page (/orders/abc) still belongs to its section; "/" only matches itself.
  const items = NAV.map((item) => ({
    ...item,
    active: item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(`${item.href}/`),
  }));

  return (
    <Sidebar
      tag="SELLER"
      items={items}
      renderLink={(item, children, className) => (
        <Link key={item.href} href={item.href} aria-current={item.active ? "page" : undefined} className={className}>
          {children}
        </Link>
      )}
    />
  );
}
