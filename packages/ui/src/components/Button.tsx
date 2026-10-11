import type { ButtonHTMLAttributes, ReactNode } from "react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger";
  children: ReactNode;
}

const variantClasses: Record<NonNullable<ButtonProps["variant"]>, string> = {
  // Orange is reserved for action per the brand guide — this is the one
  // place every app should reach for by default.
  primary: "bg-accent text-white shadow-sm shadow-accent/20 hover:brightness-95 hover:shadow-md hover:shadow-accent/25 focus-visible:ring-accent/40 active:brightness-90",
  secondary: "bg-primary text-white shadow-sm shadow-primary/20 hover:brightness-110 hover:shadow-md hover:shadow-primary/25 focus-visible:ring-primary/40 active:brightness-95",
  danger: "bg-danger text-white shadow-sm shadow-danger/20 hover:brightness-95 hover:shadow-md hover:shadow-danger/25 focus-visible:ring-danger/40 active:brightness-90",
};

export function Button({ variant = "primary", className = "", children, ...props }: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold transition-all duration-150 ease-out active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 disabled:shadow-none ${variantClasses[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
