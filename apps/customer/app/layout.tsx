import type { Metadata } from "next";
import { Geist, Geist_Mono, Montserrat } from "next/font/google";
import { ThemeScript } from "@closebuy/ui";
import { BottomNav } from "@/components/BottomNav";
import { DesktopNav } from "@/components/DesktopNav";
import { PageFrame } from "@/components/PageFrame";
import { CartProvider } from "@/lib/cart";
import { FavoritesProvider } from "@/lib/favorites";
import "./globals.css";

// Self-hosted at build time (no runtime Google Fonts request) — the
// --font-geist variable is what the shared Tailwind preset's font-sans
// actually resolves to (packages/ui/tailwind-preset.js).
const geist = Geist({ subsets: ["latin", "latin-ext"], variable: "--font-geist", display: "swap" });
const montserrat = Montserrat({ subsets: ["latin", "latin-ext"], weight: "800", variable: "--font-montserrat", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin", "latin-ext"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: "CloseBuy",
  description: "Daily needs, delivered fast.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable} ${montserrat.variable}`} suppressHydrationWarning>
      <head>
        <ThemeScript paletteBPattern="^/(search|products|checkout|orders|account|welcome|location|saved)(/|$)" />
      </head>
      <body>
        <CartProvider>
          <FavoritesProvider>
          <DesktopNav />
          <PageFrame>{children}</PageFrame>
          <BottomNav />
        </FavoritesProvider>
        </CartProvider>
      </body>
    </html>
  );
}
