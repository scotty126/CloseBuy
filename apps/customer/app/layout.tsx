import type { Metadata } from "next";
import { BottomNav } from "@/components/BottomNav";
import "./globals.css";

export const metadata: Metadata = {
  title: "CloseBuy",
  description: "Daily needs, delivered fast.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <main className="mx-auto min-h-screen max-w-lg pb-16">{children}</main>
        <BottomNav />
      </body>
    </html>
  );
}
