"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Input, useAuthSession } from "@closebuy/ui";
import { ApiClientError } from "@closebuy/api-client";
import type { AdminMetricsDto } from "@closebuy/types";
import { adminApi } from "@/lib/api";
import { bucketSeries } from "@/lib/chart";
import {
  formatCompactNaira,
  formatLongDay,
  formatMinutes,
  formatPercent,
  formatShortDay,
  formatWholeNaira,
} from "@/lib/format";
import { ColumnChart } from "@/components/ColumnChart";

// Every day on this screen is an Africa/Lagos calendar day (the API says so
// too) — "today" must be Lagos's, not the browser's, or a late-evening admin
// abroad would be looking at the wrong window.
const LAGOS_OFFSET_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function lagosToday(): string {
  return new Date(Date.now() + LAGOS_OFFSET_MS).toISOString().slice(0, 10);
}
function shiftDay(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}
function presetRange(days: number) {
  const to = lagosToday();
  return { from: shiftDay(to, -(days - 1)), to };
}

const PRESETS = [
  { key: "7", label: "Last 7 days", days: 7 },
  { key: "30", label: "Last 30 days", days: 30 },
  { key: "90", label: "Last 90 days", days: 90 },
] as const;

/** screens-navigation.md §4.6 — US-A-07. */
export default function MetricsPage() {
  const router = useRouter();
  const { session, isLoaded } = useAuthSession();

  const [range, setRange] = useState(() => presetRange(30));
  const [preset, setPreset] = useState<string>("30"); // "custom" once a date is edited by hand
  const [metrics, setMetrics] = useState<AdminMetricsDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isLoaded && !session) router.push("/login");
  }, [isLoaded, session, router]);

  const reversed = range.from > range.to;

  useEffect(() => {
    if (!session || reversed) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    adminApi
      .getMetrics(range)
      .then((res) => {
        if (!cancelled) setMetrics(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiClientError ? err.message : "Couldn't load metrics.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session, range, reversed]);

  const series = useMemo(() => (metrics ? bucketSeries(metrics.perDay) : null), [metrics]);

  if (!isLoaded || !session) return null;

  const decided = metrics
    ? metrics.orders.fulfilledCount + metrics.orders.cancelledOrRefundedCount + metrics.orders.failedCount
    : 0;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold text-ink">Metrics</h1>
        <p className="text-sm text-muted">
          How the platform is doing over a date range (US-A-07). Days are Africa/Lagos calendar days; every figure
          counts orders placed in the range unless it says &ldquo;right now&rdquo;.
        </p>
      </div>

      {/* One filter row, above everything it scopes. Presets first, custom range after. */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex gap-2" role="group" aria-label="Date range presets">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              aria-pressed={preset === p.key}
              onClick={() => {
                setPreset(p.key);
                setRange(presetRange(p.days));
              }}
              className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
                preset === p.key
                  ? "border-primary bg-primary text-white"
                  : "border-gray-300 bg-white text-ink hover:bg-surface"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="w-40">
          <Input
            label="From"
            type="date"
            value={range.from}
            max={range.to}
            onChange={(e) => {
              if (!e.target.value) return;
              setPreset("custom");
              setRange((r) => ({ ...r, from: e.target.value }));
            }}
          />
        </div>
        <div className="w-40">
          <Input
            label="To"
            type="date"
            value={range.to}
            min={range.from}
            onChange={(e) => {
              if (!e.target.value) return;
              setPreset("custom");
              setRange((r) => ({ ...r, to: e.target.value }));
            }}
          />
        </div>
      </div>

      {reversed && <p className="text-sm text-danger">The start date can&apos;t be after the end date.</p>}
      {error && <p className="text-sm text-danger">{error}</p>}

      {!metrics ? (
        !error && !reversed && <p className="text-sm text-muted">Loading…</p>
      ) : (
        // Refetch keeps the frame: hold the previous render, dimmed, instead of a skeleton or a layout jump.
        <div aria-busy={loading} className={`flex flex-col gap-4 transition-opacity ${loading ? "opacity-60" : ""}`}>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label="Orders" value={metrics.orders.placedCount.toLocaleString()} note={`${metrics.orders.inFlightCount.toLocaleString()} still in flight`} />
            <Tile
              label="Gross value"
              value={metrics.grossMinor >= 100_000_000 ? formatCompactNaira(metrics.grossMinor) : formatWholeNaira(metrics.grossMinor)}
              note="Excludes cancelled and refunded orders"
            />
            <Tile
              label="Completion rate"
              value={metrics.completionRate === null ? "—" : formatPercent(metrics.completionRate)}
              note={
                metrics.completionRate === null
                  ? "No order has reached an outcome yet"
                  : `${metrics.orders.fulfilledCount.toLocaleString()} of ${decided.toLocaleString()} orders with an outcome`
              }
            />
            <Tile
              label="Average delivery time"
              value={metrics.averageDeliveryMinutes === null ? "—" : formatMinutes(metrics.averageDeliveryMinutes)}
              note={
                metrics.deliveriesMeasured === 0
                  ? "No measurable deliveries in range"
                  : `Paid to delivered, over ${metrics.deliveriesMeasured.toLocaleString()} deliveries`
              }
            />
            <Tile label="Failed deliveries" value={metrics.orders.failedCount.toLocaleString()} note="Rider couldn't complete the delivery" />
            <Tile
              label="Disputed orders"
              value={metrics.orders.disputedCount.toLocaleString()}
              note={
                <>
                  {metrics.openDisputes.toLocaleString()} open right now ·{" "}
                  <Link href="/disputes" className="text-primary underline">
                    view queue
                  </Link>
                </>
              }
            />
            <Tile label="Active vendors" value={metrics.vendors.active.toLocaleString()} note={`of ${metrics.vendors.approved.toLocaleString()} approved right now`} />
            <Tile label="Active riders" value={metrics.riders.active.toLocaleString()} note={`of ${metrics.riders.approved.toLocaleString()} approved right now`} />
          </div>

          {/* Two measures on different scales → two charts, never one dual-axis plot. */}
          {series && (
            <>
              <ColumnChart
                title={`Orders per ${series.granularity}`}
                periodHeading={series.granularity === "week" ? "Week starting" : "Day"}
                valueHeading="Orders"
                data={series.points.map((p) => ({
                  key: p.date,
                  axisLabel: formatShortDay(p.date),
                  label: series.granularity === "week" ? `Week of ${formatLongDay(p.date)}` : formatLongDay(p.date),
                  value: p.orders,
                }))}
                formatValue={(n) => n.toLocaleString()}
                formatTick={(n) => n.toLocaleString()}
                emptyMessage="No orders were placed in this range."
              />
              <ColumnChart
                title={`Gross value per ${series.granularity}`}
                periodHeading={series.granularity === "week" ? "Week starting" : "Day"}
                valueHeading="Gross value"
                data={series.points.map((p) => ({
                  key: p.date,
                  axisLabel: formatShortDay(p.date),
                  label: series.granularity === "week" ? `Week of ${formatLongDay(p.date)}` : formatLongDay(p.date),
                  value: p.grossMinor,
                }))}
                formatValue={formatWholeNaira}
                formatTick={formatCompactNaira}
                emptyMessage="No order value in this range."
              />
              {series.granularity === "week" && (
                <p className="text-xs text-muted">Ranges longer than 120 days are grouped by week (Monday start) so the columns stay readable. The first and last weeks can be partial, so a short end column isn&apos;t necessarily a drop.</p>
              )}
            </>
          )}

          <details className="rounded-xl border border-gray-200 bg-white p-4 text-sm">
            <summary className="cursor-pointer font-medium text-ink">How these are counted</summary>
            <ul className="mt-3 flex list-disc flex-col gap-1.5 pl-5 text-muted">
              <li>
                <span className="text-ink">Orders</span> — placed in the range, meaning payment confirmed or cash-on-delivery accepted. An
                abandoned card checkout never counts.
              </li>
              <li>
                <span className="text-ink">Gross value</span> — those orders&apos; totals, minus cancelled and refunded ones. It does not net out
                goodwill refunds or partial dispute refunds, which leave the order&apos;s own status alone.
              </li>
              <li>
                <span className="text-ink">Completion rate</span> — delivered or completed, out of every order whose outcome is known
                (delivered/completed, cancelled/refunded, or delivery failed). Orders still in flight are left out so a busy afternoon
                doesn&apos;t drag it down.
              </li>
              <li>
                <span className="text-ink">Average delivery time</span> — from payment to delivered, for delivery orders only. Scheduled orders
                are excluded: their wait is the customer&apos;s choice.
              </li>
              <li>
                <span className="text-ink">Active vendors / riders</span> — had, or carried, at least one order in the range. &ldquo;Approved&rdquo; and
                &ldquo;open disputes&rdquo; are how things stand right now, not over the range.
              </li>
            </ul>
          </details>
        </div>
      )}
    </div>
  );
}

/** A stat tile: label, value, and one line of context. Proportional figures for the value — tabular digits only belong in aligned columns. */
function Tile({ label, value, note }: { label: string; value: string; note: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="text-2xl font-semibold text-ink">{value}</p>
      <p className="text-xs text-muted">{note}</p>
    </div>
  );
}
