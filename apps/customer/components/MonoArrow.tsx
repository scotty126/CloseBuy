/** A drawn "→". The self-hosted fonts don't carry the arrow glyph (the canvas's Google-hosted ones do), so a typed arrow falls back to a long system one; this matches the canvas's small arrow at any size. */
export function MonoArrow({ size = 11, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`inline-block shrink-0 ${className}`}>
      <path d="M1.5 6h9M7 2.5 10.5 6 7 9.5" />
    </svg>
  );
}
