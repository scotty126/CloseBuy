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
  { name: "Restaurants", defaultPrepMinutes: 35 }, // cooked-to-order food, longer than a grocery pick-pack
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
  { key: "founding_vendor_program_active", value: true }, // open at launch (brief §3.2a) — US-A-02's on/off switch
  { key: "founding_vendor_program_waiver_months", value: 3 }, // brief §3.2a default — US-A-02's configurable duration
  {
    key: "service_area_polygon",
    // Riverpark's real traced boundary (brief §2a, US-C-05) — supplied as
    // a geojson.io export, converted from [lng, lat] (GeoJSON's order) to
    // this app's {lat, lng} shape. The closing point (identical to the
    // first, standard GeoJSON ring closure) is dropped — the point-in-
    // polygon check doesn't need it explicitly repeated (lib/geo.ts).
    value: [
      { lat: 8.9867879, lng: 7.3303654 },
      { lat: 8.9921894, lng: 7.3419188 },
      { lat: 8.9877769, lng: 7.3449997 },
      { lat: 8.9774364, lng: 7.3495609 },
      { lat: 8.9704651, lng: 7.3506784 },
      { lat: 8.9712203, lng: 7.3437212 },
      { lat: 8.9719934, lng: 7.3425362 },
      { lat: 8.9727864, lng: 7.3415423 },
      { lat: 8.974392, lng: 7.3402044 },
      { lat: 8.9718397, lng: 7.3364862 },
      { lat: 8.9771625, lng: 7.3329444 },
      { lat: 8.9837732, lng: 7.3279248 },
      { lat: 8.9861793, lng: 7.3279007 },
    ],
  },
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

  // Admin accounts are never self-service (see the admin-only guard in
  // auth/service.ts's verifyOtp) — vendor/rider get a real application
  // flow instead (POST /vendors, /riders) precisely because anyone should
  // be able to start one. Admin has no such flow by design, so local dev
  // needs one seeded account to sign in as at all. Optional: without
  // SEED_ADMIN_PHONE set, this is a no-op and Admin stays unreachable
  // locally until you set it and re-run the seed.
  const seedAdminPhone = process.env.SEED_ADMIN_PHONE;
  if (seedAdminPhone) {
    const existing = await prisma.user.findUnique({ where: { phone: seedAdminPhone } });
    if (!existing) {
      const user = await prisma.user.create({
        data: { phone: seedAdminPhone, role: "admin", phoneVerifiedAt: new Date() },
      });
      await prisma.adminProfile.create({ data: { userId: user.id } });
      console.log(`Seeded admin user for ${seedAdminPhone}.`);
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
