"use client";

import { usePathname } from "next/navigation";
import { usePalette } from "@closebuy/ui";

// Pages whose desktop design is a wide, multi-column layout. Everything else
// (bag, checkout, orders, tracking, account…) is a single task column, so on a
// big screen it sits in a readable centred column instead of stretching edge to edge.
// The chunkier screens of the canvas use palette B; keep in sync with the pattern in layout.tsx.
const PALETTE_B = /^\/(search|products|checkout|orders|account|welcome|location|saved)(\/|$)/;
const WIDE = (p: string) => p === "/" || p.startsWith("/vendors/");

/** Width frame for every customer page: phone-width below `lg`, then wide or a centred column depending on the page. */
export function PageFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  usePalette(PALETTE_B.test(pathname));
  return (
    <main className={`mx-auto min-h-screen w-full max-w-lg pb-28 lg:pb-12 ${WIDE(pathname) ? "lg:max-w-[1280px] lg:px-10" : "lg:max-w-2xl"}`}>
      {children}
    </main>
  );
}
