import { LayoutGrid, ShoppingBasket, Shirt, Sparkles, Smartphone, House, Pill, UtensilsCrossed, Store } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { CategoryDto } from "@closebuy/types";

// Purely decorative, name-keyed lookup — Category is admin-configurable
// (US-A-02, brief §3.3) with no icon field of its own, so a new category
// just falls back to the generic Store icon rather than breaking.
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  "Food & Groceries": ShoppingBasket,
  Fashion: Shirt,
  Beauty: Sparkles,
  Electronics: Smartphone,
  Home: House,
  Pharmacy: Pill,
  Restaurants: UtensilsCrossed,
};

/**
 * The canvas's category grid: 3 across, each a 44px-high row chip (icon, then
 * label). The selected one is a tinted well with a 1px orange ring and an orange
 * icon; the rest are plain cards with a hairline.
 */
export function CategoryChips({
  categories,
  active,
  onSelect,
}: {
  categories: CategoryDto[];
  active: string | undefined;
  onSelect: (categoryId: string | undefined) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2 lg:grid-cols-6 lg:gap-2.5">
      <Chip label="All" Icon={LayoutGrid} isActive={active === undefined} onClick={() => onSelect(undefined)} />
      {categories.map((category) => (
        <Chip
          key={category.id}
          label={category.name}
          Icon={CATEGORY_ICONS[category.name] ?? Store}
          isActive={active === category.id}
          onClick={() => onSelect(category.id)}
        />
      ))}
    </div>
  );
}

function Chip({ label, Icon, isActive, onClick }: { label: string; Icon: LucideIcon; isActive: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isActive}
      className={`flex h-11 min-w-0 items-center gap-2 rounded-[10px] px-2.5 text-[13px] font-medium text-ink transition-[box-shadow,background] duration-150 ${
        isActive ? "bg-raised shadow-[inset_0_0_0_1px_#FF5A19]" : "bg-card shadow-[inset_0_0_0_1px_rgb(var(--c-line))]"
      }`}
    >
      <Icon size={18} strokeWidth={1.7} className={`shrink-0 ${isActive ? "text-accent" : "text-ink"}`} aria-hidden="true" />
      <span className={`min-w-0 text-left ${label.includes(" ") ? "line-clamp-2 leading-[1.15]" : "truncate"}`}>{label}</span>
    </button>
  );
}
