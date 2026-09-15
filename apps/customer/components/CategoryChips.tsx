import type { CategoryDto } from "@closebuy/types";

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
    <div className="flex gap-2 overflow-x-auto pb-1">
      <Chip label="All" isActive={active === undefined} onClick={() => onSelect(undefined)} />
      {categories.map((category) => (
        <Chip key={category.id} label={category.name} isActive={active === category.id} onClick={() => onSelect(category.id)} />
      ))}
    </div>
  );
}

function Chip({ label, isActive, onClick }: { label: string; isActive: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition ${
        isActive ? "bg-primary text-white" : "bg-surface text-ink"
      }`}
    >
      {label}
    </button>
  );
}
