"use client";

export interface SidebarItem {
  href: string;
  label: string;
  active: boolean;
}

/**
 * Shared desktop-first sidebar for the vendor and admin dashboards
 * (screens-navigation.md §2/§4). Takes plain hrefs/labels rather than
 * `next/link`/`usePathname` directly, so this package stays framework-light
 * and each app supplies its own routing primitives.
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
  return (
    <aside className="flex h-screen w-56 flex-col border-r border-gray-200 bg-white p-4">
      <div className="mb-6 text-lg font-bold text-primary">{title}</div>
      <nav className="flex flex-col gap-1">
        {items.map((item) =>
          renderLink(
            item,
            <span
              className={`block rounded-lg px-3 py-2 text-sm font-medium ${
                item.active ? "bg-primary/10 text-primary" : "text-muted hover:bg-surface"
              }`}
            >
              {item.label}
            </span>,
          ),
        )}
      </nav>
    </aside>
  );
}
