"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sidebar } from "@closebuy/ui";

// screens-navigation.md §4 — Applications is the default landing screen.
// Grouping, icons and short labels follow the redesign canvas (AApp).
const GROUPS = [
  {
    label: "Overview",
    items: [
      { href: "/", label: "Applications", short: "Apps", icon: "M3 3h8v8H3zM13 3h8v5h-8zM13 10h8v11h-8zM3 13h8v8H3z" },
      { href: "/metrics", label: "Metrics", short: "Metrics", icon: "M4 20V10M10 20V4M16 20v-7M22 20H2" },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/orders", label: "Orders", short: "Orders", icon: "M6 7h12l-1.2 11.2a2 2 0 0 1-2 1.8H9.2a2 2 0 0 1-2-1.8L6 7ZM9 7V6a3 3 0 0 1 6 0v1" },
      { href: "/disputes", label: "Disputes", short: "Disputes", icon: "M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" },
      { href: "/payouts", label: "Payouts & reconciliation", short: "Payouts", icon: "M3 6h18v12H3zM3 10h18M7 15h4" },
    ],
  },
  {
    label: "Partners",
    items: [
      { href: "/vendors", label: "Vendors", short: "Vendors", icon: "M3 9h18l-2 11H5L3 9ZM8 9l4-6 4 6" },
      { href: "/riders", label: "Riders", short: "Riders", icon: "M3 7h11v9H3zM14 10h4l3 3v3h-7M7 18a2 2 0 1 0 0 .1M17 18a2 2 0 1 0 0 .1" },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/config", label: "Configuration", short: "Config", icon: "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" },
      { href: "/audit-log", label: "Audit log", short: "Audit", icon: "M6 3h9l3 3v15H6zM9 9h6M9 13h6M9 17h4" },
      { href: "/notifications", label: "Notifications", short: "Alerts", icon: "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0" },
    ],
  },
];

const CHROME_LESS_ROUTES = ["/login", "/oauth-complete"];

export function AdminSidebar() {
  const pathname = usePathname();
  // Signed-out screens aren't part of the authenticated app chrome — showing
  // every internal section name (Disputes, Payouts, Audit log…) to someone
  // who hasn't signed in yet looked unfinished and leaked the nav structure
  // for no reason.
  if (CHROME_LESS_ROUTES.includes(pathname)) return null;
  // A detail page (/orders/abc) still belongs to its section; "/" only matches itself.
  const groups = GROUPS.map((g) => ({
    label: g.label,
    items: g.items.map((item) => ({
      ...item,
      active: item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(`${item.href}/`),
    })),
  }));

  return (
    <Sidebar
      tag="ADMIN"
      groups={groups}
      scrollableTabs
      renderLink={(item, children, className) => (
        <Link key={item.href} href={item.href} aria-current={item.active ? "page" : undefined} className={className}>
          {children}
        </Link>
      )}
    />
  );
}
