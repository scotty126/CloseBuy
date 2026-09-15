import type { ButtonHTMLAttributes, ReactNode } from "react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger";
  children: ReactNode;
}

const variantClasses: Record<NonNullable<ButtonProps["variant"]>, string> = {
  // Orange is reserved for action per the brand guide — this is the one
  // place every app should reach for by default.
  primary: "bg-accent text-white hover:brightness-95 active:brightness-90",
  secondary: "bg-primary text-white hover:brightness-110 active:brightness-95",
  danger: "bg-danger text-white hover:brightness-95 active:brightness-90",
};

export function Button({ variant = "primary", className = "", children, ...props }: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-sm font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed ${variantClasses[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
