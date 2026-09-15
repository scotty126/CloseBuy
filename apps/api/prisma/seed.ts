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

async function main() {
  // No natural key to upsert on (id is a random uuid) — find-or-create by
  // name instead, so re-running the seed is still idempotent.
  for (const category of CATEGORIES) {
    const existing = await prisma.category.findFirst({ where: { name: category.name } });
    if (!existing) await prisma.category.create({ data: category });
  }

  const count = await prisma.category.count();
  console.log(`Seeded categories — ${count} total.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
