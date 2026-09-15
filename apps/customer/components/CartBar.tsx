"use client";

import Link from "next/link";
import { formatNaira, minor } from "@closebuy/types";
import { useCart } from "@/lib/cart";

/** Floating "view cart" bar — DoorDash's pattern, shown on Home/Search/Vendor whenever the cart holds something. Sits above BottomNav, below the fold otherwise. */
export function CartBar() {
  const { cart, itemCount, subtotalMinor, isLoaded } = useCart();

  if (!isLoaded || itemCount === 0 || !cart.vendor) return null;

  return (
    <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom,0px))] z-10 mx-auto w-full max-w-lg px-4">
      <Link
        href="/cart"
        className="flex items-center justify-between rounded-xl bg-primary px-4 py-3 text-white shadow-lg"
      >
        <span className="text-sm font-medium">
          {itemCount} item{itemCount > 1 ? "s" : ""} · {cart.vendor.businessName}
        </span>
        <span className="text-sm font-semibold">View cart · {formatNaira(minor(subtotalMinor))}</span>
      </Link>
    </div>
  );
}
