import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createAdminMetricsService, resolveMetricsRange, InvalidMetricsRangeError } from "./metrics.js";

/** In-memory fake Prisma — covers exactly what admin/metrics.ts reads. */
function createFakePrisma() {
  const orders: any[] = [];
  const transitions: any[] = [];
  const disputes = new Map<string, any>(); // keyed by orderId
  const counts = { approvedVendors: 0, approvedRiders: 0, openDisputes: 0 };

  const db: any = {
    order: {
      findMany: async ({ where }: any) =>
        orders
          .filter((o) => o.createdAt >= where.createdAt.gte && o.createdAt < where.createdAt.lt && o.status !== where.status.not)
          .map((o) => ({ ...o, dispute: disputes.has(o.id) ? { id: `d_${o.id}` } : null })),
    },
    orderStateTransition: {
      findMany: async ({ where }: any) =>
        transitions.filter((t) => where.orderId.in.includes(t.orderId) && where.toStatus.in.includes(t.toStatus)),
    },
    vendorProfile: { count: async () => counts.approvedVendors },
    riderProfile: { count: async () => counts.approvedRiders },
    dispute: { count: async () => counts.openDisputes },
    __state: { orders, transitions, disputes, counts },
  };
  return db as PrismaClient & { __state: typeof db.__state };
}

let nextId = 1;
function order(prisma: ReturnType<typeof createFakePrisma>, overrides: Record<string, unknown> = {}) {
  const o = {
    id: `o_${nextId++}`,
    status: "COMPLETED",
    totalMinor: 100000,
    createdAt: new Date("2026-09-10T10:00:00Z"),
    vendorId: "vendor_1",
    riderId: null,
    fulfilmentType: "delivery",
    scheduledFor: null,
    ...overrides,
  };
  prisma.__state.orders.push(o);
  return o;
}

function transitionPair(prisma: ReturnType<typeof createFakePrisma>, orderId: string, paidAt: string, deliveredAt: string) {
  prisma.__state.transitions.push(
    { orderId, toStatus: "PAID", createdAt: new Date(paidAt) },
    { orderId, toStatus: "DELIVERED", createdAt: new Date(deliveredAt) },
  );
}

const RANGE = { from: "2026-09-01", to: "2026-09-30" };

describe("resolveMetricsRange", () => {
  it("defaults to the 30 days ending today", () => {
    expect(resolveMetricsRange({}, new Date("2026-09-24T12:00:00Z"))).toEqual({ from: "2026-08-26", to: "2026-09-24" });
  });

  it("'today' is the Lagos day, not the UTC one — 23:30 UTC is already tomorrow in Lagos", () => {
    expect(resolveMetricsRange({}, new Date("2026-09-24T23:30:00Z")).to).toBe("2026-09-25");
  });

  it("keeps an explicit range as given", () => {
    expect(resolveMetricsRange(RANGE)).toEqual(RANGE);
  });

  it("rejects a reversed range", () => {
    expect(() => resolveMetricsRange({ from: "2026-09-10", to: "2026-09-01" })).toThrow(InvalidMetricsRangeError);
  });

  it("allows exactly 366 days and rejects 367", () => {
    expect(() => resolveMetricsRange({ from: "2026-01-01", to: "2027-01-01" })).not.toThrow(); // 366 days inclusive
    expect(() => resolveMetricsRange({ from: "2026-01-01", to: "2027-01-02" })).toThrow(InvalidMetricsRangeError);
  });
});

describe("admin metrics — getMetrics (US-A-07)", () => {
  it("buckets orders into Lagos calendar days: 22:59 UTC is still the same day, 23:00 UTC is the next", async () => {
    const prisma = createFakePrisma();
    order(prisma, { createdAt: new Date("2026-09-01T22:59:00Z") }); // Lagos 23:59 on 09-01
    order(prisma, { createdAt: new Date("2026-09-01T23:00:00Z") }); // Lagos 00:00 on 09-02
    const svc = createAdminMetricsService({ prisma });

    const m = await svc.getMetrics({ from: "2026-09-01", to: "2026-09-02" });

    expect(m.perDay).toEqual([
      { date: "2026-09-01", orders: 1, grossMinor: 100000 },
      { date: "2026-09-02", orders: 1, grossMinor: 100000 },
    ]);
  });

  it("the range itself is Lagos-aligned: an order just before Lagos midnight of `from` is out, just after is in", async () => {
    const prisma = createFakePrisma();
    order(prisma, { createdAt: new Date("2026-08-31T22:59:00Z") }); // Lagos 23:59 on 08-31 — outside
    order(prisma, { createdAt: new Date("2026-08-31T23:00:00Z") }); // Lagos 00:00 on 09-01 — inside
    const svc = createAdminMetricsService({ prisma });

    const m = await svc.getMetrics(RANGE);
    expect(m.orders.placedCount).toBe(1);
  });

  it("zero-fills quiet days so the series is continuous", async () => {
    const prisma = createFakePrisma();
    order(prisma, { createdAt: new Date("2026-09-02T10:00:00Z") });
    const m = await createAdminMetricsService({ prisma }).getMetrics({ from: "2026-09-01", to: "2026-09-03" });

    expect(m.perDay.map((d) => [d.date, d.orders])).toEqual([
      ["2026-09-01", 0],
      ["2026-09-02", 1],
      ["2026-09-03", 0],
    ]);
  });

  it("an empty range reports zeros and null rates rather than dividing by nothing", async () => {
    const m = await createAdminMetricsService({ prisma: createFakePrisma() }).getMetrics(RANGE);

    expect(m.orders.placedCount).toBe(0);
    expect(m.grossMinor).toBe(0);
    expect(m.completionRate).toBeNull();
    expect(m.averageDeliveryMinutes).toBeNull();
    expect(m.deliveriesMeasured).toBe(0);
    expect(m.perDay).toHaveLength(30);
  });

  it("never counts an abandoned checkout (PENDING_PAYMENT) as an order", async () => {
    const prisma = createFakePrisma();
    order(prisma, { status: "PENDING_PAYMENT" });
    order(prisma, { status: "PAID" });
    const m = await createAdminMetricsService({ prisma }).getMetrics(RANGE);

    expect(m.orders.placedCount).toBe(1);
  });

  it("gross excludes cancelled and refunded orders but still counts in-flight and delivery-failed ones", async () => {
    const prisma = createFakePrisma();
    order(prisma, { status: "COMPLETED", totalMinor: 100000 });
    order(prisma, { status: "PAID", totalMinor: 20000 });
    order(prisma, { status: "DELIVERY_FAILED", totalMinor: 3000 });
    order(prisma, { status: "CANCELLED", totalMinor: 999999 });
    order(prisma, { status: "REFUNDED", totalMinor: 999999 });
    const m = await createAdminMetricsService({ prisma }).getMetrics(RANGE);

    expect(m.grossMinor).toBe(123000);
    // …and the per-day series has to agree with the headline, or the screen contradicts itself.
    expect(m.perDay.reduce((s, d) => s + d.grossMinor, 0)).toBe(m.grossMinor);
    // cancelled/refunded still count as *orders* that day, just not as gross value
    expect(m.orders.placedCount).toBe(5);
  });

  it("completion rate is fulfilled ÷ decided — in-flight orders are left out of the denominator", async () => {
    const prisma = createFakePrisma();
    order(prisma, { status: "DELIVERED" });
    order(prisma, { status: "COMPLETED" });
    order(prisma, { status: "CANCELLED" });
    order(prisma, { status: "REFUNDED" });
    order(prisma, { status: "DELIVERY_FAILED" });
    order(prisma, { status: "PREPARING" });
    order(prisma, { status: "IN_TRANSIT" });
    order(prisma, { status: "PAID" });
    const m = await createAdminMetricsService({ prisma }).getMetrics(RANGE);

    expect(m.completionRate).toBeCloseTo(2 / 5); // 3 in-flight ignored
    expect(m.orders).toMatchObject({ fulfilledCount: 2, inFlightCount: 3, failedCount: 1, cancelledOrRefundedCount: 2 });
  });

  it("completion rate is null while every order is still in flight", async () => {
    const prisma = createFakePrisma();
    order(prisma, { status: "PAID" });
    order(prisma, { status: "PREPARING" });
    const m = await createAdminMetricsService({ prisma }).getMetrics(RANGE);

    expect(m.completionRate).toBeNull();
  });

  it("average delivery time is PAID → DELIVERED, over delivery orders only, scheduled and unmeasurable ones excluded", async () => {
    const prisma = createFakePrisma();
    const a = order(prisma, { status: "COMPLETED" });
    const b = order(prisma, { status: "DELIVERED" });
    const pickup = order(prisma, { status: "COMPLETED", fulfilmentType: "pickup" });
    const scheduled = order(prisma, { status: "COMPLETED", scheduledFor: new Date("2026-09-12T18:00:00Z") });
    const noPaidTransition = order(prisma, { status: "COMPLETED" });
    transitionPair(prisma, a.id, "2026-09-10T10:00:00Z", "2026-09-10T10:30:00Z"); // 30 min
    transitionPair(prisma, b.id, "2026-09-10T11:00:00Z", "2026-09-10T11:50:00Z"); // 50 min
    transitionPair(prisma, pickup.id, "2026-09-10T10:00:00Z", "2026-09-10T15:00:00Z"); // would wreck the average
    transitionPair(prisma, scheduled.id, "2026-09-10T10:00:00Z", "2026-09-12T18:00:00Z"); // ditto
    prisma.__state.transitions.push({ orderId: noPaidTransition.id, toStatus: "DELIVERED", createdAt: new Date("2026-09-10T12:00:00Z") });

    const m = await createAdminMetricsService({ prisma }).getMetrics(RANGE);

    expect(m.averageDeliveryMinutes).toBe(40);
    expect(m.deliveriesMeasured).toBe(2);
  });

  it("counts each vendor and rider once however many orders they had, and ignores orders with no rider yet", async () => {
    const prisma = createFakePrisma();
    order(prisma, { vendorId: "v1", riderId: "r1" });
    order(prisma, { vendorId: "v1", riderId: "r1" });
    order(prisma, { vendorId: "v2", riderId: null });
    prisma.__state.counts.approvedVendors = 10;
    prisma.__state.counts.approvedRiders = 4;
    const m = await createAdminMetricsService({ prisma }).getMetrics(RANGE);

    expect(m.vendors).toEqual({ approved: 10, active: 2 });
    expect(m.riders).toEqual({ approved: 4, active: 1 });
  });

  it("disputed count is orders in range that have a dispute; open disputes is the current queue, not range-scoped", async () => {
    const prisma = createFakePrisma();
    const disputed = order(prisma, {});
    order(prisma, {});
    prisma.__state.disputes.set(disputed.id, {});
    prisma.__state.counts.openDisputes = 7;
    const m = await createAdminMetricsService({ prisma }).getMetrics(RANGE);

    expect(m.orders.disputedCount).toBe(1);
    expect(m.openDisputes).toBe(7);
  });

  it("rejects a bad range before touching the database", async () => {
    await expect(
      createAdminMetricsService({ prisma: createFakePrisma() }).getMetrics({ from: "2026-09-10", to: "2026-09-01" }),
    ).rejects.toThrow(InvalidMetricsRangeError);
  });
});
