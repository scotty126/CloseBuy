"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const CHROME_LESS_ROUTES = ["/login", "/oauth-complete"];

/**
 * Signed-out screens aren't part of the authenticated app chrome — a
 * Notifications/Earnings header on the login screen implied a session that
 * doesn't exist yet, same reasoning as AdminSidebar/VendorSidebar.
 */
export function RiderHeader() {
  const pathname = usePathname();
  if (CHROME_LESS_ROUTES.includes(pathname)) return null;

  return (
    <header className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
      <span className="text-lg font-bold text-primary">CloseBuy Rider</span>
      <div className="flex items-center gap-4">
        <Link href="/notifications" className="text-sm font-medium text-muted transition-colors hover:text-ink">
          Notifications
        </Link>
        <Link href="/earnings" className="text-sm font-medium text-muted transition-colors hover:text-ink">
          Earnings
        </Link>
      </div>
    </header>
  );
}
