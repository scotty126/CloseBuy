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
        {/* Below `lg` the sidebar is a top bar + drawer (block flow); from `lg` it sits beside the page.
            min-w-0 lets wide content (tables) scroll inside itself instead of stretching the page. */}
        <div className="min-h-screen lg:flex">
          <AdminSidebar />
          <main className="min-w-0 flex-1 p-4 sm:p-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
