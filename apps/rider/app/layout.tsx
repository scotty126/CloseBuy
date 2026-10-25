import type { Metadata } from "next";
import { Geist, Geist_Mono, Montserrat } from "next/font/google";
import { ThemeScript } from "@closebuy/ui";
import { RiderHeader } from "@/components/RiderHeader";
import "./globals.css";

const geist = Geist({ subsets: ["latin", "latin-ext"], variable: "--font-geist", display: "swap" });
const montserrat = Montserrat({ subsets: ["latin", "latin-ext"], weight: "800", variable: "--font-montserrat", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin", "latin-ext"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: "CloseBuy Rider",
  description: "Deliver with CloseBuy.",
};

// Deliberately no persistent tab bar — screens-navigation.md §3: this app is
// single-task by design, so a glance mid-delivery never has to think about
// where to tap. Just a minimal top bar with an escape hatch to Earnings.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable} ${montserrat.variable}`} suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body>
        <RiderHeader />
        <main className="mx-auto min-h-screen max-w-lg pb-28">{children}</main>
      </body>
    </html>
  );
}
