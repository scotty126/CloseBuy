"use client";

import { useEffect, useRef, useState } from "react";

export interface SidebarItem {
  href: string;
  label: string;
  active: boolean;
}

// Tailwind's `lg` — the width at which the menu stops being a drawer and sits beside the page.
const DESKTOP_MIN_WIDTH = 1024;

/**
 * Shared navigation for the vendor and admin dashboards (screens-navigation.md
 * §2/§4). Takes plain hrefs/labels rather than `next/link`/`usePathname`
 * directly, so this package stays framework-light and each app supplies its
 * own routing primitives.
 *
 * Desktop (`lg`+): a fixed-width column beside the page, as before.
 * Below that it collapses to a slim top bar with a menu button, and the menu
 * becomes a drawer over the page — it used to be a permanent 224px column, which
 * on a phone left about 160px for the actual screen and couldn't be dismissed.
 * The drawer closes on a link tap, a tap on the backdrop, Escape, or the ✕.
 */
export function Sidebar({
  title,
  items,
  renderLink,
}: {
  title: string;
  items: SidebarItem[];
  renderLink: (item: SidebarItem, children: React.ReactNode) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const activeHref = items.find((i) => i.active)?.href;

  // A navigation that lands somewhere new (including via the browser's back button) puts the page back in view.
  useEffect(() => {
    setOpen(false);
  }, [activeHref]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        menuButtonRef.current?.focus();
      }
    };
    // Rotating a tablet (or resizing a window) up to the desktop layout shouldn't leave the page scroll-locked.
    const onResize = () => {
      if (window.innerWidth >= DESKTOP_MIN_WIDTH) setOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden"; // the page behind a modal drawer shouldn't scroll under a thumb
    closeButtonRef.current?.focus();
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  return (
    <>
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-2.5 lg:hidden">
        <button
          ref={menuButtonRef}
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          aria-expanded={open}
          aria-controls="app-menu"
          className="-ml-2 flex h-10 w-10 items-center justify-center rounded-lg text-ink hover:bg-surface"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
        <span className="text-base font-bold text-primary">{title}</span>
      </header>

      {open && <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setOpen(false)} aria-hidden="true" />}

      <aside
        id="app-menu"
        // `invisible` while closed keeps the off-screen links out of the tab order and the accessibility tree.
        className={`fixed inset-y-0 left-0 z-50 flex w-64 max-w-[85vw] flex-col overflow-y-auto border-r border-gray-200 bg-white p-4 transition-[transform,visibility] duration-200 lg:visible lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:w-56 lg:max-w-none lg:shrink-0 lg:translate-x-0 ${
          open ? "visible translate-x-0" : "invisible -translate-x-full"
        }`}
      >
        <div className="mb-6 flex items-center justify-between gap-2">
          <span className="text-lg font-bold text-primary">{title}</span>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            className="-mr-2 flex h-10 w-10 items-center justify-center rounded-lg text-muted hover:bg-surface lg:hidden"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        {/* Bubbles from the links, so tapping the page you're already on closes the drawer too. */}
        <nav className="flex flex-col gap-1" onClick={() => setOpen(false)}>
          {items.map((item) =>
            renderLink(
              item,
              <span
                className={`block rounded-lg px-3 py-2.5 text-sm font-medium ${
                  item.active ? "bg-primary/10 text-primary" : "text-muted hover:bg-surface"
                }`}
              >
                {item.label}
              </span>,
            ),
          )}
        </nav>
      </aside>
    </>
  );
}
