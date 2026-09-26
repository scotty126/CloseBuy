import type { PrismaClient } from "@prisma/client";
import { MAX_METRICS_RANGE_DAYS } from "@closebuy/types";
import type { AdminMetricsDto, AdminMetricsQuery } from "@closebuy/types";

/**
 * US-A-07 — platform health. Own module, same precedent as ./orders.js and
 * friends (own Prisma access, read-only here).
 *
 * The definitions below are the contract — a metrics screen that doesn't say
 * what its numbers mean is worse than none, so the UI restates them too.
 *
 *  - Everything is cohorted by the order's *placement* day in Africa/Lagos
 *    (UTC+1, no DST), so a given day's figures never shift once it's over.
 *  - "Placed" = payment confirmed or COD accepted, i.e. anything but
 *    PENDING_PAYMENT. An abandoned card checkout never becomes an order.
 *  - Fulfilled = DELIVERED or COMPLETED. Completion rate = fulfilled ÷
 *    (fulfilled + cancelled/refunded + delivery-failed): of the orders whose
 *    outcome is *known*. In-flight orders are left out of the denominator so
 *    a busy afternoon doesn't drag the rate down for orders that simply
 *    haven't finished yet.
 *  - Gross = placed orders' totals minus CANCELLED/REFUNDED. It does NOT net
 *    out goodwill refunds or partial dispute refunds — those deliberately
 *    leave the order's own status alone (admin/orders.ts's force-refund,
 *    admin/disputes.ts's partial_refund), so they can't be seen from here.
 *  - Average delivery time = PAID → DELIVERED for delivery-fulfilment orders,
 *    scheduled ones excluded (their wait is the customer's choice, not a
 *    speed measure). The number of orders it's over is returned alongside.
 */

export class InvalidMetricsRangeError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export interface AdminMetricsServiceDeps {
  prisma: PrismaClient;
}

const LAGOS_OFFSET_MS = 60 * 60 * 1000; // UTC+1, fixed — Nigeria has no DST
const DAY_MS = 24 * 60 * 60 * 1000;

const FULFILLED = ["DELIVERED", "COMPLETED"];
const IN_FLIGHT = ["PAID", "PREPARING", "READY_FOR_PICKUP", "RIDER_ASSIGNED", "IN_TRANSIT"];
const CANCELLED_OR_REFUNDED = ["CANCELLED", "REFUNDED"];

/** The Lagos calendar day (YYYY-MM-DD) an instant falls on. */
function lagosDay(at: Date): string {
  return new Date(at.getTime() + LAGOS_OFFSET_MS).toISOString().slice(0, 10);
}

function addDays(day: string, n: number): string {
  return new Date(new Date(`${day}T00:00:00Z`).getTime() + n * DAY_MS).toISOString().slice(0, 10);
}

/** Exported for tests: fills in the defaults and rejects a reversed or over-long range. */
export function resolveMetricsRange(query: AdminMetricsQuery, now: Date = new Date()): { from: string; to: string } {
  const to = query.to ?? lagosDay(now);
  const from = query.from ?? addDays(to, -29);

  if (from > to) throw new InvalidMetricsRangeError("The start date can't be after the end date.");
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS + 1;
  if (days > MAX_METRICS_RANGE_DAYS) {
    throw new InvalidMetricsRangeError(`That range is ${days} days — the most a single view covers is ${MAX_METRICS_RANGE_DAYS}.`);
  }
  return { from, to };
}

export function createAdminMetricsService({ prisma }: AdminMetricsServiceDeps) {
  return {
    async getMetrics(query: AdminMetricsQuery, now: Date = new Date()): Promise<AdminMetricsDto> {
      const range = resolveMetricsRange(query, now);
      // Lagos midnight expressed as an instant: 00:00 local = 23:00 UTC the day before.
      const start = new Date(Date.parse(`${range.from}T00:00:00Z`) - LAGOS_OFFSET_MS);
      const endExclusive = new Date(Date.parse(`${range.to}T00:00:00Z`) + DAY_MS - LAGOS_OFFSET_MS);

      const orders = await prisma.order.findMany({
        where: { createdAt: { gte: start, lt: endExclusive }, status: { not: "PENDING_PAYMENT" } },
        select: {
          id: true,
          status: true,
          totalMinor: true,
          createdAt: true,
          vendorId: true,
          riderId: true,
          fulfilmentType: true,
          scheduledFor: true,
          dispute: { select: { id: true } },
        },
      });

      // One zero-filled bucket per day so the chart is continuous — a quiet
      // day is a real data point, not a gap.
      const perDay = new Map<string, { orders: number; grossMinor: number }>();
      for (let day = range.from; day <= range.to; day = addDays(day, 1)) perDay.set(day, { orders: 0, grossMinor: 0 });

      let grossMinor = 0;
      let fulfilled = 0;
      let inFlight = 0;
      let failed = 0;
      let cancelledOrRefunded = 0;
      let disputed = 0;
      const activeVendors = new Set<string>();
      const activeRiders = new Set<string>();

      for (const o of orders) {
        const counted = !CANCELLED_OR_REFUNDED.includes(o.status);
        const bucket = perDay.get(lagosDay(o.createdAt));
        if (bucket) {
          bucket.orders += 1;
          if (counted) bucket.grossMinor += o.totalMinor;
        }
        if (counted) grossMinor += o.totalMinor;

        if (FULFILLED.includes(o.status)) fulfilled += 1;
        else if (IN_FLIGHT.includes(o.status)) inFlight += 1;
        else if (o.status === "DELIVERY_FAILED") failed += 1;
        else if (CANCELLED_OR_REFUNDED.includes(o.status)) cancelledOrRefunded += 1;

        if (o.dispute) disputed += 1;
        activeVendors.add(o.vendorId);
        if (o.riderId) activeRiders.add(o.riderId);
      }

      const decided = fulfilled + cancelledOrRefunded + failed;

      // PAID → DELIVERED per eligible order. One query for the whole set
      // (bounded by the range cap), paired up in memory.
      const measurable = orders.filter((o) => o.fulfilmentType === "delivery" && !o.scheduledFor && FULFILLED.includes(o.status));
      let averageDeliveryMinutes: number | null = null;
      let deliveriesMeasured = 0;
      if (measurable.length > 0) {
        const transitions = await prisma.orderStateTransition.findMany({
          where: { orderId: { in: measurable.map((o) => o.id) }, toStatus: { in: ["PAID", "DELIVERED"] } },
          select: { orderId: true, toStatus: true, createdAt: true },
        });
        const paidAt = new Map<string, number>();
        const deliveredAt = new Map<string, number>();
        for (const t of transitions) {
          const target = t.toStatus === "PAID" ? paidAt : deliveredAt;
          const ms = t.createdAt.getTime();
          const existing = target.get(t.orderId);
          if (existing === undefined || ms < existing) target.set(t.orderId, ms); // earliest, in case of any oddity
        }
        const durations: number[] = [];
        for (const o of measurable) {
          const p = paidAt.get(o.id);
          const d = deliveredAt.get(o.id);
          if (p !== undefined && d !== undefined && d >= p) durations.push((d - p) / 60_000);
        }
        deliveriesMeasured = durations.length;
        if (durations.length > 0) {
          averageDeliveryMinutes = Math.round((durations.reduce((s, x) => s + x, 0) / durations.length) * 10) / 10;
        }
      }

      const [approvedVendors, approvedRiders, openDisputes] = await Promise.all([
        prisma.vendorProfile.count({ where: { status: "approved" } }),
        prisma.riderProfile.count({ where: { status: "approved" } }),
        prisma.dispute.count({ where: { status: "open" } }),
      ]);

      return {
        range,
        timezone: "Africa/Lagos",
        orders: {
          placedCount: orders.length,
          fulfilledCount: fulfilled,
          inFlightCount: inFlight,
          failedCount: failed,
          cancelledOrRefundedCount: cancelledOrRefunded,
          disputedCount: disputed,
        },
        grossMinor,
        completionRate: decided > 0 ? fulfilled / decided : null,
        averageDeliveryMinutes,
        deliveriesMeasured,
        openDisputes,
        vendors: { approved: approvedVendors, active: activeVendors.size },
        riders: { approved: approvedRiders, active: activeRiders.size },
        perDay: [...perDay.entries()].map(([date, v]) => ({ date, orders: v.orders, grossMinor: v.grossMinor })),
      };
    },
  };
}

export type AdminMetricsService = ReturnType<typeof createAdminMetricsService>;
