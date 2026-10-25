"use client";

import { useAuthSession } from "../hooks/useAuthSession";
import { ThemeToggle } from "./Theme";

export interface SidebarItem {
  href: string;
  label: string;
  active: boolean;
  /** SVG path data (24×24, stroked) for the nav icon. */
  icon?: string;
  /** Short label for the phone tab bar (falls back to `label`). */
  short?: string;
  /** Small count pill, e.g. new orders waiting. */
  badge?: number;
  /** Items with `mobile: false` only appear in the desktop sidebar (phone tab bar holds ~5). */
  mobile?: boolean;
}

export interface SidebarGroup {
  label?: string;
  items: SidebarItem[];
}

function Icon({ d, size = 17, stroke = 1.8 }: { d?: string; size?: number; stroke?: number }) {
  if (!d) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

const LOGOUT_ICON = "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9";

/**
 * Shared navigation for the vendor and admin apps (screens-navigation.md §2/§4),
 * in the redesign's shape: a 240px sidebar from `lg` up (brand + app tag, icon
 * nav, theme + log out), and below that a slim top bar plus a floating tab bar
 * — the same pattern as the customer app, so a phone never gets a drawer.
 * Takes plain hrefs/labels rather than `next/link`/`usePathname` so this package
 * stays framework-light; each app supplies its own routing primitives.
 *
 * `groups` is optional: a flat `items` list renders as one unlabelled group.
 */
export function Sidebar({
  tag,
  items,
  groups,
  renderLink,
  footer,
  scrollableTabs = false,
}: {
  /** App label next to the logo, e.g. "SELLER", "ADMIN". */
  tag: string;
  items?: SidebarItem[];
  groups?: SidebarGroup[];
  renderLink: (item: SidebarItem, children: React.ReactNode, className: string) => React.ReactNode;
  /** Extra block pinned above the log-out row on desktop (e.g. a balance card). */
  footer?: React.ReactNode;
  /** An app with more than five sections (admin) lets the phone tab bar scroll sideways instead of truncating it. */
  scrollableTabs?: boolean;
}) {
  const { clear } = useAuthSession();
  const allGroups: SidebarGroup[] = groups ?? [{ items: items ?? [] }];
  const flat = allGroups.flatMap((g) => g.items);
  const mobileItems = flat.filter((i) => i.mobile !== false).slice(0, scrollableTabs ? flat.length : 5);

  function logOut() {
    clear();
    window.location.href = "/login";
  }

  return (
    <>
      {/* Phone / tablet: top bar */}
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-surface/90 px-3.5 py-2 backdrop-blur-md lg:hidden">
        {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset */}
        <img src="/logo-mark.png" alt="" className="object-contain h-[23px] w-[22px]" />
        <span className="rounded-[5px] px-1.5 py-0.5 font-mono text-[10px] text-muted shadow-[inset_0_0_0_1px_rgb(var(--c-line))]">{tag}</span>
        <span className="flex-1" />
        <ThemeToggle className="!h-10 !w-10 !bg-transparent !shadow-none" />
        <button type="button" onClick={logOut} aria-label="Log out" className="flex h-10 w-10 items-center justify-center text-muted">
          <Icon d={LOGOUT_ICON} size={17} />
        </button>
      </header>

      {/* Desktop: sidebar */}
      <aside
        aria-label="Navigation"
        className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-[18px] overflow-y-auto border-r border-line bg-surface px-3 py-[18px] lg:flex"
      >
        <div className="flex items-center gap-2 px-1.5">
          {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset */}
          <img src="/logo-mark.png" alt="" className="object-contain h-6 w-6" />
          <span className="font-display text-lg tracking-[-0.02em] text-accent">CloseBuy</span>
          <span className="rounded-[5px] px-1.5 py-0.5 font-mono text-[10px] text-muted shadow-[inset_0_0_0_1px_rgb(var(--c-line))]">{tag}</span>
        </div>

        <nav className="flex flex-col gap-3.5">
          {allGroups.map((g, gi) => (
            <div key={g.label ?? gi} className="flex flex-col gap-0.5">
              {g.label && <span className="px-2.5 pb-1 font-mono text-[10px] uppercase tracking-[0.06em] text-muted">{g.label}</span>}
              {g.items.map((item) =>
                renderLink(
                  item,
                  <>
                    <span className={item.active ? "text-accent" : "text-muted"}>
                      <Icon d={item.icon} />
                    </span>
                    <span className="flex-1">{item.label}</span>
                    {item.badge ? (
                      <span className="rounded-[5px] bg-accent px-1.5 py-0.5 font-mono text-[10px] text-night">{item.badge}</span>
                    ) : null}
                  </>,
                  `flex h-10 items-center gap-2.5 rounded-[9px] px-2.5 text-sm transition-colors ${
                    item.active ? "bg-card font-medium text-ink shadow-[inset_0_0_0_1px_rgb(var(--c-line))]" : "text-ink hover:bg-raised"
                  }`,
                ),
              )}
            </div>
          ))}
        </nav>

        <div className="mt-auto flex flex-col gap-2">
          {footer}
          <div className="flex items-center gap-1 px-1.5">
            <button type="button" onClick={logOut} className="flex h-11 flex-1 items-center gap-2.5 rounded-[9px] px-2 text-[13px] text-muted transition-colors hover:bg-raised hover:text-ink">
              <Icon d={LOGOUT_ICON} size={16} />
              Log out
            </button>
            <ThemeToggle className="!h-11 !w-11 !bg-transparent !shadow-none" />
          </div>
        </div>
      </aside>

      {/* Phone / tablet: floating tab bar */}
      <nav
        aria-label="Main"
        className={`fixed inset-x-3.5 bottom-[calc(0.75rem+env(safe-area-inset-bottom,0px))] z-30 mx-auto flex h-[60px] max-w-[30rem] items-center rounded-[18px] ${scrollableTabs ? "overflow-x-auto px-1 [scrollbar-width:none]" : "justify-around"} bg-card/90 shadow-[0_0_0_1px_rgb(var(--c-line)),0_12px_30px_rgba(14,31,25,0.14)] backdrop-blur-xl lg:hidden`}
      >
        {mobileItems.map((item) =>
          renderLink(
            item,
            <>
              <span
                className={`absolute -top-1 h-[3px] rounded-sm bg-accent transition-all duration-300 ${item.active ? "w-[18px] opacity-100" : "w-0 opacity-0"}`}
                aria-hidden="true"
              />
              <span className={item.active ? "text-accent" : ""}>
                <Icon d={item.icon} size={20} stroke={1.9} />
              </span>
              {item.short ?? item.label}
              {item.badge ? (
                <span className="absolute right-3 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-night">{item.badge}</span>
              ) : null}
            </>,
            `relative flex h-[52px] w-[66px] shrink-0 flex-col items-center justify-center gap-[3px] font-mono text-[10px] uppercase transition-colors active:scale-95 ${item.active ? "text-ink" : "text-muted"}`,
          ),
        )}
      </nav>
    </>
  );
}
