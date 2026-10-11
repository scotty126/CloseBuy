"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sidebar } from "@closebuy/ui";

// screens-navigation.md §2 — Orders is the default landing screen.
const NAV = [
  { href: "/", label: "Orders" },
  { href: "/products", label: "Products" },
  { href: "/settings", label: "Store settings" },
  { href: "/earnings", label: "Earnings & payouts" },
  { href: "/notifications", label: "Notifications" },
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
      title="CloseBuy Vendor"
      items={items}
      renderLink={(item, children) => (
        <Link key={item.href} href={item.href}>
          {children}
        </Link>
      )}
    />
  );
}
