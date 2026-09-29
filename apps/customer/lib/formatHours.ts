const DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const DAY_LABEL: Record<(typeof DAY_ORDER)[number], string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

function formatTime(t: string): string {
  const [h = 0, m = 0] = t.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12} ${period}` : `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

export interface HoursSummary {
  today: string;
  days: string;
}

/**
 * Vendor.openingHours can genuinely differ per day (data-model.md) —
 * this never claims "every day" unless every set day really does share
 * the same range, and never shows a day that was never set at all.
 * Purely informational (screens-navigation.md's store-landing reference);
 * the real open/closed truth stays the isOpen badge next to it.
 */
export function summarizeHours(openingHours: Record<string, [string, string]> | null): HoursSummary | null {
  if (!openingHours) return null;
  const setDays = DAY_ORDER.filter((d) => openingHours[d]);
  if (setDays.length === 0) return null;

  const ranges = setDays.map((d) => openingHours[d]!.join("-"));
  const allSame = ranges.every((r) => r === ranges[0]);
  const days =
    setDays.length === 7 && allSame
      ? "Every day"
      : setDays.length === 7
        ? "Every day (hours vary)"
        : setDays.map((d) => DAY_LABEL[d]).join(", ");

  const todayKey = DAY_ORDER[(new Date().getDay() + 6) % 7]!; // JS getDay(): 0=Sun; rotate to Mon-first
  const todayRange = openingHours[todayKey];
  const today = todayRange ? `${formatTime(todayRange[0])} – ${formatTime(todayRange[1])}` : "Closed today";

  return { today, days };
}
