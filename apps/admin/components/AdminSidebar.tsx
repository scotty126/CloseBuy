"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sidebar } from "@closebuy/ui";

// screens-navigation.md §4 — Applications is the default landing screen.
const NAV = [
  { href: "/", label: "Applications" },
  { href: "/orders", label: "Orders" },
  { href: "/disputes", label: "Disputes" },
  { href: "/config", label: "Configuration" },
  { href: "/payouts", label: "Payouts & reconciliation" },
  { href: "/metrics", label: "Metrics" },
  { href: "/audit-log", label: "Audit log" },
];

export function AdminSidebar() {
  const pathname = usePathname();
  const items = NAV.map((item) => ({ ...item, active: pathname === item.href }));

  return (
    <Sidebar
      title="CloseBuy Admin"
      items={items}
      renderLink={(item, children) => (
        <Link key={item.href} href={item.href}>
          {children}
        </Link>
      )}
    />
  );
}
