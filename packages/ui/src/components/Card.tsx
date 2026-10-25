import type { HTMLAttributes, ReactNode } from "react";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function Card({ className = "", children, ...props }: CardProps) {
  return (
    <div
      // rounded-2xl + a soft two-layer shadow matches the customer app's
      // hand-rolled card shape (VendorCard etc.) — this primitive had drifted
      // to a flatter rounded-xl/shadow-sm that only admin's screens ever saw.
      className={`rounded-2xl border border-line bg-card p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_20px_-12px_rgba(0,0,0,0.1)] ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
