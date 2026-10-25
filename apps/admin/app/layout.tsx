import type { Metadata } from "next";
import { Geist, Geist_Mono, Montserrat } from "next/font/google";
import { ThemeScript } from "@closebuy/ui";
import { AdminSidebar } from "@/components/AdminSidebar";
import "./globals.css";

const geist = Geist({ subsets: ["latin", "latin-ext"], variable: "--font-geist", display: "swap" });
const montserrat = Montserrat({ subsets: ["latin", "latin-ext"], weight: "800", variable: "--font-montserrat", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin", "latin-ext"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: "CloseBuy Admin",
  description: "CloseBuy platform operations.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable} ${montserrat.variable}`} suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body>
        {/* Below `lg` the sidebar is a top bar + drawer (block flow); from `lg` it sits beside the page.
            min-w-0 lets wide content (tables) scroll inside itself instead of stretching the page. */}
        <div className="min-h-screen lg:flex">
          <AdminSidebar />
          <main className="min-w-0 flex-1 p-4 pb-28 sm:p-6 sm:pb-28 lg:pb-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
