/**
 * Pure helpers behind the metrics charts — kept out of the React components
 * so the geometry can be checked without a browser.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Round-number y-axis ticks from 0 up to at least `max` (0 / 50 / 100 / 150),
 * never more than ~5 of them. Charts here always start at zero — bars encode
 * length, so a truncated baseline would lie.
 *
 * Whole steps only by default: everything plotted is a count of orders or an
 * amount in kobo, and an axis reading "1.5 orders" is nonsense. (Caught by
 * actually rendering a quiet week — a max of 2 produced 0 / 0.5 / 1 / 1.5 / 2.)
 */
export function niceTicks(max: number, target = 4, wholeStepsOnly = true): number[] {
  if (!(max > 0)) return [0, 1];
  const rough = max / target;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalised = rough / magnitude;
  let step = (normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10) * magnitude;
  if (wholeStepsOnly) step = Math.max(1, step);

  const ticks: number[] = [];
  for (let v = 0; v < max + step; v += step) {
    ticks.push(Math.round(v * 1e6) / 1e6); // shed float dust (0.1 + 0.2 …)
    if (v >= max) break;
  }
  return ticks;
}

/** Which of `count` x positions get a label — at most `maxLabels`, evenly spaced, so labels never collide. */
export function labelIndices(count: number, maxLabels = 6): number[] {
  if (count <= 0) return [];
  const step = Math.max(1, Math.ceil(count / maxLabels));
  const out: number[] = [];
  for (let i = 0; i < count; i += step) out.push(i);
  return out;
}

/**
 * Column geometry. Bars are capped at 24px and never fill their slot; the
 * leftover is air (and for touching bars, the 2px surface gap the marks spec
 * asks for). Below ~3px a slot can't afford the gap, so it shrinks to 1px.
 */
export function barWidth(slotWidth: number): number {
  const withGap = slotWidth - 2;
  return Math.min(24, withGap >= 1 ? withGap : Math.max(1, slotWidth - 1));
}

/** A column with a 4px rounded data-end and a square baseline. */
export function columnPath(x: number, width: number, top: number, baseline: number, radius = 4): string {
  const height = baseline - top;
  if (height <= 0 || width <= 0) return "";
  const r = Math.min(radius, height, width / 2);
  return (
    `M${x},${baseline} V${top + r} Q${x},${top} ${x + r},${top} ` +
    `H${x + width - r} Q${x + width},${top} ${x + width},${top + r} V${baseline} Z`
  );
}

export interface DailyPoint {
  date: string; // YYYY-MM-DD
  orders: number;
  grossMinor: number;
}

/** Monday of the week a calendar day falls in (weeks read more naturally than a fortnight of hairline bars on a long range). */
function weekStart(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const sinceMonday = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - sinceMonday * DAY_MS).toISOString().slice(0, 10);
}

/** Past this many days, one column per day is too thin to read — group by week. */
export const WEEKLY_AFTER_DAYS = 120;

export function bucketSeries(perDay: DailyPoint[]): { granularity: "day" | "week"; points: DailyPoint[] } {
  if (perDay.length <= WEEKLY_AFTER_DAYS) return { granularity: "day", points: perDay };

  const weeks = new Map<string, DailyPoint>();
  for (const p of perDay) {
    const key = weekStart(p.date);
    const w = weeks.get(key) ?? { date: key, orders: 0, grossMinor: 0 };
    w.orders += p.orders;
    w.grossMinor += p.grossMinor;
    weeks.set(key, w);
  }
  return { granularity: "week", points: [...weeks.values()] };
}
