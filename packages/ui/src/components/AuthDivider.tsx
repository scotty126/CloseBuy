/** The canvas's "OR" rule between a form and the one-tap provider below it. */
export function AuthDivider() {
  return (
    <div className="flex items-center gap-2.5 font-mono text-[11px] text-muted" role="separator">
      <span className="h-px flex-1 bg-line" />
      OR
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}
