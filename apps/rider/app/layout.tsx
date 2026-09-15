import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "CloseBuy Rider",
  description: "Deliver with CloseBuy.",
};

// Deliberately no persistent tab bar — screens-navigation.md §3: this app is
// single-task by design, so a glance mid-delivery never has to think about
// where to tap. Just a minimal top bar with an escape hatch to Earnings.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
          <span className="text-lg font-bold text-primary">CloseBuy Rider</span>
          <Link href="/earnings" className="text-sm font-medium text-muted">
            Earnings
          </Link>
        </header>
        <main className="mx-auto min-h-screen max-w-lg">{children}</main>
      </body>
    </html>
  );
}
