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
];

export function VendorSidebar() {
  const pathname = usePathname();
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
