import type { Metadata } from "next";
import { AdminSidebar } from "@/components/AdminSidebar";
import "./globals.css";

export const metadata: Metadata = {
  title: "CloseBuy Admin",
  description: "CloseBuy platform operations.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="flex min-h-screen">
          <AdminSidebar />
          <main className="flex-1 overflow-y-auto p-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
