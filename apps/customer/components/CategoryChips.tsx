import { LayoutGrid, ShoppingBasket, Shirt, Sparkles, Smartphone, House, Pill, UtensilsCrossed, Store } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { CategoryDto } from "@closebuy/types";

// Purely decorative, name-keyed lookup — Category is admin-configurable
// (US-A-02, brief §3.3) with no icon field of its own, so a new category
// just falls back to the generic Store icon rather than breaking. Matches
// DoorDash's home category rail (screens-navigation.md's reference kit):
// circular icon + label, not text pill chips.
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  "Food & Groceries": ShoppingBasket,
  Fashion: Shirt,
  Beauty: Sparkles,
  Electronics: Smartphone,
  Home: House,
  Pharmacy: Pill,
  Restaurants: UtensilsCrossed,
};

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
    <div className="flex gap-4 overflow-x-auto pb-1">
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

function Chip({
  label,
  Icon,
  isActive,
  onClick,
}: {
  label: string;
  Icon: LucideIcon;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="flex w-[4.5rem] shrink-0 flex-col items-center gap-1.5">
      <span
        className={`flex h-16 w-16 items-center justify-center rounded-full transition ${
          isActive ? "bg-primary text-white shadow-md shadow-primary/25" : "bg-surface text-ink"
        }`}
      >
        <Icon size={26} strokeWidth={isActive ? 2.25 : 2} />
      </span>
      <span className={`w-full truncate text-center text-xs font-semibold ${isActive ? "text-primary" : "text-muted"}`}>
        {label}
      </span>
    </button>
  );
}
