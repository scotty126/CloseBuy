import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { RiderHeader } from "@/components/RiderHeader";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "CloseBuy Rider",
  description: "Deliver with CloseBuy.",
};

// Deliberately no persistent tab bar — screens-navigation.md §3: this app is
// single-task by design, so a glance mid-delivery never has to think about
// where to tap. Just a minimal top bar with an escape hatch to Earnings.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <RiderHeader />
        <main className="mx-auto min-h-screen max-w-lg">{children}</main>
      </body>
    </html>
  );
}
