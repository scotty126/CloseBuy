"use client";

import { useState } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  /** Sits at the right end of the label row, e.g. "Forgot?" beside Password. */
  labelAside?: ReactNode;
}

export function Input({ label, error, labelAside, id, className = "", ...props }: InputProps) {
  const inputId = id ?? props.name;
  // A password field gets the canvas's mono SHOW/HIDE toggle in its right edge.
  const isPassword = props.type === "password";
  const [revealed, setRevealed] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor={inputId} className="text-sm font-medium text-ink">
            {label}
          </label>
          {labelAside}
        </div>
      )}
      <div className="relative">
        <input
          id={inputId}
          className={`w-full rounded-xl border bg-card px-3 py-2.5 text-sm text-ink outline-none transition-all duration-150 ease-out placeholder:text-muted/60 focus:ring-4 ${
            error ? "border-danger focus:ring-danger/10" : "border-line hover:border-line focus:border-primary focus:ring-primary/10"
          } ${isPassword ? "pr-16" : ""} ${className}`}
          aria-invalid={Boolean(error)}
          {...props}
            type={isPassword && revealed ? "text" : props.type}
          />
        {isPassword && (
          <button
            type="button"
            onClick={() => setRevealed((v) => !v)}
            aria-label={revealed ? "Hide password" : "Show password"}
            aria-pressed={revealed}
            className="absolute inset-y-0 right-0 flex w-16 items-center justify-center font-mono text-[11px] uppercase text-muted"
          >
            {revealed ? "Hide" : "Show"}
          </button>
        )}
      </div>
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}
