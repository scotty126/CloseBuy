"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

const STORAGE_KEY = "closebuy.cart";

export interface CartItem {
  productId: string;
  name: string;
  priceMinor: number;
  quantity: number;
  stock: number; // snapshot at add-time — a soft client-side clamp only; checkout re-validates against live stock regardless
}

export interface CartVendor {
  id: string;
  businessName: string;
  supportsPickup: boolean;
}

interface CartState {
  vendor: CartVendor | null;
  items: CartItem[];
  fulfilmentType: "delivery" | "pickup";
  scheduledFor: string | null; // ISO string; null = as soon as possible
}

const EMPTY_CART: CartState = { vendor: null, items: [], fulfilmentType: "delivery", scheduledFor: null };

interface AddItemResult {
  added: boolean;
  // Set when the cart already holds a different vendor's items — the cart
  // is single-vendor only (brief §3.1), so the caller must confirm
  // clearing it first (US-C-04), rather than this silently swapping carts.
  conflictWithVendor?: string;
}

interface CartContextValue {
  cart: CartState;
  isLoaded: boolean;
  itemCount: number;
  subtotalMinor: number;
  addItem: (vendor: CartVendor, item: Omit<CartItem, "quantity">, quantity?: number) => AddItemResult;
  replaceCart: (vendor: CartVendor, item: Omit<CartItem, "quantity">, quantity?: number) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  removeItem: (productId: string) => void;
  clearCart: () => void;
  setFulfilmentType: (type: "delivery" | "pickup") => void;
  setScheduledFor: (iso: string | null) => void;
}

const CartContext = createContext<CartContextValue | null>(null);

function addOrMergeItem(items: CartItem[], item: Omit<CartItem, "quantity">, quantity: number): CartItem[] {
  const existing = items.find((i) => i.productId === item.productId);
  if (!existing) return [...items, { ...item, quantity }];
  return items.map((i) => (i.productId === item.productId ? { ...i, quantity: i.quantity + quantity } : i));
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<CartState>(EMPTY_CART);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) setCart(JSON.parse(raw) as CartState);
    } catch {
      // Private-browsing / storage-blocked — proceed with an empty cart rather than throw.
    } finally {
      setIsLoaded(true);
    }
  }, []);

  const persist = useCallback((next: CartState) => {
    setCart(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore — cart still works for this tab via React state.
    }
  }, []);

  const addItem = useCallback(
    (vendor: CartVendor, item: Omit<CartItem, "quantity">, quantity = 1): AddItemResult => {
      if (cart.vendor && cart.vendor.id !== vendor.id) {
        return { added: false, conflictWithVendor: cart.vendor.businessName };
      }
      persist({ ...cart, vendor, items: addOrMergeItem(cart.items, item, quantity) });
      return { added: true };
    },
    [cart, persist],
  );

  const replaceCart = useCallback(
    (vendor: CartVendor, item: Omit<CartItem, "quantity">, quantity = 1) => {
      persist({ vendor, items: [{ ...item, quantity }], fulfilmentType: "delivery", scheduledFor: null });
    },
    [persist],
  );

  const updateQuantity = useCallback(
    (productId: string, quantity: number) => {
      if (quantity <= 0) {
        const items = cart.items.filter((i) => i.productId !== productId);
        persist(items.length === 0 ? EMPTY_CART : { ...cart, items });
        return;
      }
      persist({ ...cart, items: cart.items.map((i) => (i.productId === productId ? { ...i, quantity } : i)) });
    },
    [cart, persist],
  );

  const removeItem = useCallback((productId: string) => updateQuantity(productId, 0), [updateQuantity]);

  const clearCart = useCallback(() => persist(EMPTY_CART), [persist]);

  const setFulfilmentType = useCallback(
    (type: "delivery" | "pickup") => persist({ ...cart, fulfilmentType: type }),
    [cart, persist],
  );

  const setScheduledFor = useCallback((iso: string | null) => persist({ ...cart, scheduledFor: iso }), [cart, persist]);

  const itemCount = cart.items.reduce((sum, i) => sum + i.quantity, 0);
  const subtotalMinor = cart.items.reduce((sum, i) => sum + i.priceMinor * i.quantity, 0);

  const value = useMemo(
    () => ({
      cart,
      isLoaded,
      itemCount,
      subtotalMinor,
      addItem,
      replaceCart,
      updateQuantity,
      removeItem,
      clearCart,
      setFulfilmentType,
      setScheduledFor,
    }),
    [cart, isLoaded, itemCount, subtotalMinor, addItem, replaceCart, updateQuantity, removeItem, clearCart, setFulfilmentType, setScheduledFor],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within a CartProvider");
  return ctx;
}
