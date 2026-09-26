/** Number formatting for the metrics screen. Minor units in (kobo), display strings out. */

/** ₦12,500 — whole naira, for tiles where kobo is noise. */
export function formatWholeNaira(minor: number): string {
  return `₦${Math.round(minor / 100).toLocaleString("en-NG")}`;
}

/** ₦4.2M / ₦12.9K / ₦850 — for axis ticks and large tile values. */
export function formatCompactNaira(minor: number): string {
  const naira = minor / 100;
  const abs = Math.abs(naira);
  if (abs >= 1_000_000_000) return `₦${trim(naira / 1_000_000_000)}B`;
  if (abs >= 1_000_000) return `₦${trim(naira / 1_000_000)}M`;
  if (abs >= 1_000) return `₦${trim(naira / 1_000)}K`;
  return `₦${Math.round(naira)}`;
}

function trim(n: number): string {
  return String(Math.round(n * 10) / 10); // 4.2, but 5 not 5.0
}

/** 0.875 → "87.5%" */
export function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 1000) / 10}%`;
}

/** 42 → "42 min", 95 → "1 h 35 min" */
export function formatMinutes(minutes: number): string {
  const rounded = Math.round(minutes);
  if (rounded < 90) return `${rounded} min`;
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** 2026-09-05 → "5 Sep" */
export function formatShortDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** 2026-09-05 → "Sat 5 Sep 2026" */
export function formatLongDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
