"use client";

import { useId } from "react";
import { toLocalDigits } from "@closebuy/types";

export interface PhoneInputProps {
  label?: string;
  /** The canonical value the parent stores — "", a full `+234…`, or (briefly, mid-typing) whatever's been typed so far. PhoneInput re-derives what to display from this every render, so the parent never needs to normalize it itself. */
  value: string;
  /** Called with the canonical `+234…` form, or "" once the local part is empty. */
  onChange: (value: string) => void;
  required?: boolean;
  id?: string;
  name?: string;
  /** Placeholder for the local part, after the fixed +234 chip. */
  placeholder?: string;
  autoComplete?: string;
  error?: string;
}

/**
 * A phone field with a fixed, non-editable `+234` chip — the person types
 * the number the way they'd actually dial it locally (`0907 701 8785`,
 * leading 0 and all), and this emits the E.164 form every screen and the
 * API actually want. Before this, every phone field was a plain text input
 * with a `+2348012345678` placeholder as the only hint, and typing the
 * ordinary local form silently produced an invalid number until a
 * submit-time `normalizePhone()` pass papered over it — this makes the
 * expected format visible instead of implicit.
 *
 * Pasting a *complete* number in any of the usual forms (`+234…`, `234…`,
 * `0…`) still works — `toLocalDigits` recognises all three (it's
 * `normalizePhone`'s counterpart, packages/types/src/auth.ts) — but the
 * field is otherwise Nigeria-only, matching phoneSchema's own scope.
 */
export function PhoneInput({ label, value, onChange, required, id, name, placeholder = "8012345678", autoComplete = "tel-national", error }: PhoneInputProps) {
  const autoId = useId();
  const inputId = id ?? name ?? autoId;
  const local = toLocalDigits(value);

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={inputId} className="text-sm font-medium text-ink">
          {label}
        </label>
      )}
      <div
        className={`flex items-stretch overflow-hidden rounded-lg border bg-white transition focus-within:ring-2 focus-within:ring-primary/30 ${
          error ? "border-danger" : "border-gray-300 focus-within:border-primary"
        }`}
      >
        <span className="flex select-none items-center border-r border-gray-300 bg-surface px-3 text-sm font-medium text-muted" aria-hidden="true">
          +234
        </span>
        <input
          id={inputId}
          name={name}
          type="tel"
          inputMode="numeric"
          autoComplete={autoComplete}
          required={required}
          aria-invalid={Boolean(error)}
          placeholder={placeholder}
          value={local}
          onChange={(e) => {
            const digits = toLocalDigits(e.target.value);
            onChange(digits ? `+234${digits}` : "");
          }}
          className="min-w-0 flex-1 px-3 py-2.5 text-sm outline-none"
        />
      </div>
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}
