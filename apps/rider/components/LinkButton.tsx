import type { AnchorHTMLAttributes, ReactNode } from "react";

/** A Button-styled <a> — nesting an actual <button> inside an anchor (Navigate/Call links) is invalid HTML, so this replicates Button's "secondary" look directly on the anchor instead. */
export function LinkButton({ className = "", children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { children: ReactNode }) {
  return (
    <a
      className={`inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 active:brightness-95 ${className}`}
      {...props}
    >
      {children}
    </a>
  );
}
