import { PrismaClient } from "@prisma/client";

/**
 * Categories are admin-managed (US-A-02) — there's no admin UI to create
 * them yet, so local dev needs a seed rather than being blocked on that.
 * The category list itself is illustrative, matching brief §3.3's table,
 * not exhaustive; more get added through the real admin UI once it exists.
 */
const CATEGORIES = [
  { name: "Food & Groceries", defaultPrepMinutes: 20 },
  { name: "Fashion", defaultPrepMinutes: 120 },
  { name: "Beauty", defaultPrepMinutes: 120 },
  { name: "Electronics", defaultPrepMinutes: 120 },
  { name: "Home", defaultPrepMinutes: 120 },
  { name: "Pharmacy", defaultPrepMinutes: 15 },
];

const prisma = new PrismaClient();

// Admin-configurable (US-A-02), no admin UI yet — version 1 of each, so
// Order/Payments have somewhere real to read from. brief §3.2a for the
// commission split; the rest are reasonable starting defaults, not
// researched figures, and are exactly what the (unbuilt) admin config
// screen exists to let someone change later.
const CONFIG: Array<{ key: string; value: unknown }> = [
  { key: "commission_rate.pickup", value: 5 }, // percent, brief §3.2a
  { key: "commission_rate.delivery", value: 10 }, // percent, brief §3.2a
  { key: "vendor_accept_window_minutes", value: 15 },
  { key: "escrow_release_window_hours", value: 48 }, // US-C-11's dispute window
  { key: "flat_delivery_fee_minor", value: 50000 }, // ₦500 — see lib/config.ts for why this is flat, not distance-based
];

async function main() {
  // No natural key to upsert on (id is a random uuid) — find-or-create by
  // name instead, so re-running the seed is still idempotent.
  for (const category of CATEGORIES) {
    const existing = await prisma.category.findFirst({ where: { name: category.name } });
    if (!existing) await prisma.category.create({ data: category });
  }

  for (const c of CONFIG) {
    const existing = await prisma.config.findFirst({ where: { key: c.key } });
    if (!existing) {
      await prisma.config.create({
        data: { key: c.key, value: c.value as any, version: 1, effectiveAt: new Date() },
      });
    }
  }

  const count = await prisma.category.count();
  console.log(`Seeded categories — ${count} total.`);
  console.log(`Seeded config — ${CONFIG.length} keys.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
