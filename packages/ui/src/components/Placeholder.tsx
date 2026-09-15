/** Marks a screen that's real in the nav (screens-navigation.md) but not yet built — M1+ per roadmap.md. */
export function Placeholder({ title, note }: { title: string; note?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-gray-300 p-10 text-center">
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      <p className="max-w-sm text-sm text-muted">
        {note ?? "This screen is scoped in docs/02-design/screens-navigation.md and scheduled in docs/03-planning/roadmap.md — not built yet."}
      </p>
    </div>
  );
}
