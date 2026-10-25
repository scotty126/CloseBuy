"use client";

import Link from "next/link";
import { formatNaira, minor } from "@closebuy/types";
import { useCart } from "@/lib/cart";
import { MonoArrow } from "@/components/MonoArrow";

/** The floating dark "checkout" bar shown on a shop page whenever the bag holds something (the design's replacement for the tab bar there). */
export function CartBar() {
  const { cart, itemCount, subtotalMinor, isLoaded } = useCart();

  if (!isLoaded || itemCount === 0 || !cart.vendor) return null;

  return (
    <div className="fixed inset-x-0 bottom-[calc(0.875rem+env(safe-area-inset-bottom,0px))] z-20 mx-auto w-full max-w-lg px-4">
      <Link
        href="/cart"
        className="flex items-center justify-between rounded-[18px] bg-[#0E1F19] dark:bg-[#183F33] py-2.5 pl-4 pr-2.5 text-[#F3EEE9] shadow-[0_12px_30px_rgba(14,31,25,0.2)] transition-transform active:scale-[0.99]"
      >
        <span className="flex flex-col font-mono">
          <span className="text-[17px] font-semibold">{formatNaira(minor(subtotalMinor))}</span>
          <span className="text-[10px] opacity-75">
            {itemCount} ITEM{itemCount > 1 ? "S" : ""} IN BAG
          </span>
        </span>
        <span className="flex h-[42px] items-center gap-2 rounded-[11px] bg-accent px-4 text-sm font-semibold text-[#0E1F19]">
          Checkout <MonoArrow size={12} />
        </span>
      </Link>
    </div>
  );
}
