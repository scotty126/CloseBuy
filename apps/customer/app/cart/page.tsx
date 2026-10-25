"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ShoppingBag } from "lucide-react";
import { formatNaira, minor } from "@closebuy/types";
import { useCart } from "@/lib/cart";
import { catalogApi } from "@/lib/api";
import { MonoArrow } from "@/components/MonoArrow";
import { tileFor } from "@/components/DealCard";

/**
 * screens-navigation.md §1.5, to the canvas's measurements. Delivery-or-pickup
 * and now-or-later are chosen at checkout (the canvas puts them in its Delivery
 * card), so this screen is just the lines and the totals. The delivery fee is
 * the platform's flat fee from the public /delivery-fee endpoint — the same
 * Config value checkout charges.
 */
export default function CartPage() {
  const router = useRouter();
  const { cart, isLoaded, itemCount, subtotalMinor, updateQuantity, removeItem, clearCart } = useCart();
  const [feeMinor, setFeeMinor] = useState<number | null>(null);

  useEffect(() => {
    catalogApi.getDeliveryFee().then((res) => setFeeMinor(res.feeMinor)).catch(() => {});
  }, []);

  if (!isLoaded) return null;

  const header = (
    <header className="flex items-center gap-1.5 border-b border-line p-2">
      <button type="button" onClick={() => (window.history.length > 1 ? router.back() : router.push("/"))} aria-label="Back" className="flex h-11 w-11 items-center justify-center text-ink">
        <ArrowLeft size={18} strokeWidth={2} />
      </button>
      <div className="flex flex-1 flex-col">
        <h1 className="text-[17px] font-semibold tracking-[-0.02em] text-ink">Cart</h1>
        <span className="font-mono text-[11px] uppercase text-muted">
          {itemCount} item{itemCount === 1 ? "" : "s"} · {cart.vendor ? "1 shop" : "0 shops"}
        </span>
      </div>
      {cart.items.length > 0 && (
        <button type="button" onClick={clearCart} className="h-11 px-2.5 text-[13px] text-muted">
          Clear
        </button>
      )}
    </header>
  );

  if (!cart.vendor || cart.items.length === 0) {
    return (
      <div className="flex flex-col">
        {header}
        <div className="m-3.5 flex flex-col items-center gap-2 rounded-[14px] px-5 py-10 text-center shadow-[inset_0_0_0_1px_rgb(var(--c-line))]">
          {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset */}
          <img src="/logo-mark.png" alt="" className="h-[46px] w-auto opacity-50" />
          <span className="font-semibold text-ink">Your cart is empty</span>
          <Link href="/" className="inline-flex items-center gap-1.5 text-[13px] text-ink">
            Browse shops near you <MonoArrow size={11} />
          </Link>
        </div>
      </div>
    );
  }

  const delivering = cart.fulfilmentType === "delivery";

  return (
    <div className="flex min-h-screen flex-col">
      {header}

      <div className="flex flex-1 flex-col gap-3.5 px-3.5 pb-5 pt-3.5">
        <section className="overflow-hidden rounded-[14px] bg-card shadow-[inset_0_0_0_1px_rgb(var(--c-line))]">
          <Link href={`/vendors/${cart.vendor.id}`} className="flex items-center gap-2 border-b border-line px-3.5 py-2.5 text-[13px] font-medium text-ink">
            <span className="h-1.5 w-1.5 rounded-full bg-[#22C55E]" aria-hidden="true" />
            {cart.vendor.businessName}
            <span className="ml-auto inline-flex items-center gap-1 font-mono text-[11px] text-muted">
              Add more <MonoArrow size={10} />
            </span>
          </Link>
          {cart.items.map((item) => (
            <div key={item.productId} className="flex items-center gap-3 border-b border-line px-3.5 py-2.5">
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] text-[#0E1F19] ${tileFor(item.productId)}`}>
                <ShoppingBag size={20} strokeWidth={1.5} aria-hidden="true" />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-[13px] font-medium text-ink">{item.name}</span>
                <span className="font-mono text-xs text-ink">{formatNaira(minor(item.priceMinor * item.quantity))}</span>
              </div>
              <span className="flex h-9 items-center rounded-[9px] font-mono shadow-[inset_0_0_0_1px_rgb(var(--c-line))]">
                <button
                  type="button"
                  onClick={() => (item.quantity <= 1 ? removeItem(item.productId) : updateQuantity(item.productId, item.quantity - 1))}
                  aria-label={item.quantity <= 1 ? `Remove ${item.name}` : `One less ${item.name}`}
                  className="flex h-11 w-[30px] items-center justify-center text-ink"
                >
                  −
                </button>
                <span key={item.quantity} className="min-w-3.5 animate-bump text-center text-[13px] font-semibold text-ink">
                  {item.quantity}
                </span>
                <button
                  type="button"
                  onClick={() => updateQuantity(item.productId, item.quantity + 1)}
                  disabled={item.quantity >= item.stock}
                  aria-label={`One more ${item.name}`}
                  className="flex h-11 w-[30px] items-center justify-center text-ink disabled:opacity-40"
                >
                  +
                </button>
              </span>
            </div>
          ))}
        </section>

        <section className="flex flex-col gap-2 rounded-[14px] bg-card p-3.5 text-[13px] shadow-[inset_0_0_0_1px_rgb(var(--c-line))]">
          <Row label="Subtotal" value={formatNaira(minor(subtotalMinor))} />
          <Row label="Delivery" value={delivering ? (feeMinor != null ? formatNaira(minor(feeMinor)) : "At checkout") : "None · pickup"} />
        </section>
      </div>

      <div className="border-t border-line px-3.5 pb-3.5 pt-2.5">
        <button
          type="button"
          onClick={() => router.push("/checkout")}
          className="flex h-[50px] w-full items-center justify-between rounded-xl bg-accent px-[18px] text-sm font-semibold text-[#0E1F19] transition-transform active:scale-[0.99]"
        >
          <span>Go to checkout</span>
          <span className="flex items-center gap-1.5 font-mono">
            {formatNaira(minor(subtotalMinor))} <MonoArrow size={11} />
          </span>
        </button>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex justify-between">
      <span className="text-muted">{label}</span>
      <span className="font-mono text-ink">{value}</span>
    </span>
  );
}
