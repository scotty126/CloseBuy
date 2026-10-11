import type { InputHTMLAttributes } from "react";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export function Input({ label, error, id, className = "", ...props }: InputProps) {
  const inputId = id ?? props.name;
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={inputId} className="text-sm font-medium text-ink">
          {label}
        </label>
      )}
      <input
        id={inputId}
        className={`rounded-xl border bg-white px-3 py-2.5 text-sm text-ink outline-none transition-all duration-150 ease-out placeholder:text-muted/60 focus:ring-4 ${
          error ? "border-danger focus:ring-danger/10" : "border-gray-200 hover:border-gray-300 focus:border-primary focus:ring-primary/10"
        } ${className}`}
        aria-invalid={Boolean(error)}
        {...props}
      />
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}
