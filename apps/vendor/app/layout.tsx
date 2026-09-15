import type { Metadata } from "next";
import { VendorSidebar } from "@/components/VendorSidebar";
import "./globals.css";

export const metadata: Metadata = {
  title: "CloseBuy Vendor",
  description: "Manage your CloseBuy storefront.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="flex min-h-screen">
          <VendorSidebar />
          <main className="flex-1 overflow-y-auto p-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
