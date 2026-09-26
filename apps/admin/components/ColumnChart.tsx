"use client";

import { useState } from "react";
import { barWidth, columnPath, labelIndices, niceTicks } from "@/lib/chart";

export interface ColumnDatum {
  key: string;
  /** Short axis label, e.g. "5 Sep". */
  axisLabel: string;
  /** Full label for the tooltip and the table view, e.g. "Sat 5 Sep 2026". */
  label: string;
  value: number;
}

interface Props {
  title: string;
  /** What one column is, for the table header and the aria text — "Day" / "Week of". */
  periodHeading: string;
  valueHeading: string;
  data: ColumnDatum[];
  formatValue: (n: number) => string;
  formatTick: (n: number) => string;
  emptyMessage: string;
}

// Plot geometry, in viewBox units. The SVG scales to its container width;
// the height budget includes the x-axis band, so the card never has to
// scroll inside itself.
const W = 760;
const H = 220;
const PAD = { left: 52, right: 10, top: 22, bottom: 26 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

/**
 * A single-series column chart, hand-built rather than pulled from a chart
 * library — the admin app has none, and this is the only one it needs.
 *
 * Follows the dataviz marks spec: columns capped at 24px with a 4px rounded
 * data-end and a square baseline, hairline solid gridlines, the peak labelled
 * (never a number on every bar), ink-coloured text (never the series colour),
 * a per-column hover/focus tooltip whose hit area is the whole slot, and a
 * table view as the accessible twin. Single series → no legend box; the title
 * says what's plotted. The series colour is the brand green (`primary`,
 * #255748): it fails the *categorical* palette validator's lightness/chroma
 * checks (those guard a hue being told apart from its neighbours — moot with
 * one series) and passes its contrast check against the white card.
 */
export function ColumnChart({ title, periodHeading, valueHeading, data, formatValue, formatTick, emptyMessage }: Props) {
  const [active, setActive] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  const max = Math.max(0, ...data.map((d) => d.value));
  const ticks = niceTicks(max);
  const yMax = ticks[ticks.length - 1]!;
  const slot = data.length > 0 ? PLOT_W / data.length : PLOT_W;
  const width = barWidth(slot);
  const baseline = PAD.top + PLOT_H;
  const yFor = (v: number) => baseline - (v / yMax) * PLOT_H;

  const peakIndex = max > 0 ? data.findIndex((d) => d.value === max) : -1;
  const labelled = new Set(labelIndices(data.length));
  const slotCentre = (i: number) => PAD.left + (i + 0.5) * slot;
  const activePct = active === null ? 0 : (slotCentre(active) / W) * 100;

  return (
    <figure className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <figcaption className="text-sm font-semibold text-ink">{title}</figcaption>
        {max > 0 && (
          <button
            type="button"
            onClick={() => setShowTable((v) => !v)}
            aria-pressed={showTable}
            className="rounded-md px-2 py-1 text-xs font-medium text-primary underline-offset-2 hover:underline"
          >
            {showTable ? "Chart view" : "Table view"}
          </button>
        )}
      </div>

      {max === 0 ? (
        <p className="py-10 text-center text-sm text-muted">{emptyMessage}</p>
      ) : showTable ? (
        <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-100">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-surface text-xs uppercase text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">{periodHeading}</th>
                <th className="px-3 py-2 text-right font-medium">{valueHeading}</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.key} className="border-t border-gray-100">
                  <td className="px-3 py-1.5 text-ink">{d.label}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-ink">{formatValue(d.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="group" aria-label={title}>
            {/* Gridlines: solid hairlines, one step off the surface. Tick labels carry the values the columns don't. */}
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={W - PAD.right} y1={yFor(t)} y2={yFor(t)} stroke="#E5E7EB" strokeWidth={1} />
                <text x={PAD.left - 8} y={yFor(t)} textAnchor="end" dominantBaseline="middle" className="fill-muted" fontSize={11}>
                  {formatTick(t)}
                </text>
              </g>
            ))}

            {data.map((d, i) => {
              const x = PAD.left + i * slot + (slot - width) / 2;
              return (
                <g key={d.key}>
                  <path
                    d={columnPath(x, width, yFor(d.value), baseline)}
                    className="fill-primary"
                    fillOpacity={active === i ? 0.75 : 1}
                  />
                  {labelled.has(i) && (
                    <text x={slotCentre(i)} y={H - 8} textAnchor="middle" className="fill-muted" fontSize={11}>
                      {d.axisLabel}
                    </text>
                  )}
                  {/* The hit target is the whole slot, full plot height — never just the painted pixels. */}
                  <rect
                    x={PAD.left + i * slot}
                    y={PAD.top}
                    width={slot}
                    height={PLOT_H}
                    fill="transparent"
                    tabIndex={0}
                    role="graphics-symbol"
                    aria-label={`${d.label}: ${formatValue(d.value)}`}
                    onPointerEnter={() => setActive(i)}
                    onPointerMove={() => setActive(i)}
                    onPointerLeave={() => setActive(null)}
                    onFocus={() => setActive(i)}
                    onBlur={() => setActive(null)}
                    className="outline-none focus-visible:stroke-primary"
                    strokeWidth={1}
                  />
                </g>
              );
            })}

            {/* Selective direct label: the peak only. */}
            {peakIndex >= 0 && (
              <text
                x={slotCentre(peakIndex)}
                y={yFor(max) - 6}
                textAnchor={peakIndex < 2 ? "start" : peakIndex > data.length - 3 ? "end" : "middle"}
                className="fill-ink"
                fontSize={12}
                fontWeight={600}
                pointerEvents="none"
              >
                {formatValue(max)}
              </text>
            )}
          </svg>

          {active !== null && data[active] && (
            <div
              role="status"
              className="pointer-events-none absolute top-0 z-10 rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-md"
              style={{
                left: `${activePct}%`,
                transform: `translateX(${activePct < 14 ? "0" : activePct > 86 ? "-100%" : "-50%"})`,
              }}
            >
              <p className="text-sm font-semibold text-ink">{formatValue(data[active]!.value)}</p>
              <p className="text-xs text-muted">{data[active]!.label}</p>
            </div>
          )}
        </div>
      )}
    </figure>
  );
}
