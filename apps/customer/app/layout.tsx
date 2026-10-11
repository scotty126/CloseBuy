import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { BottomNav } from "@/components/BottomNav";
import { CartProvider } from "@/lib/cart";
import "./globals.css";

// Self-hosted at build time (no runtime Google Fonts request) — the
// --font-inter variable is what the shared Tailwind preset's font-sans
// actually resolves to (packages/ui/tailwind-preset.js).
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "CloseBuy",
  description: "Daily needs, delivered fast.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <CartProvider>
          <main className="mx-auto min-h-screen max-w-lg pb-16">{children}</main>
          <BottomNav />
        </CartProvider>
      </body>
    </html>
  );
}
