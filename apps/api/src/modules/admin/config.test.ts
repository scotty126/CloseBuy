import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createAdminConfigService, CategoryNotFoundError } from "./config.js";

/** In-memory fake Prisma — covers exactly what admin/config.ts touches, including real multi-version Config rows (not a single-row-per-key map). */
function createFakePrisma() {
  const configRows: any[] = [];
  const categories = new Map<string, any>();
  const auditLog: any[] = [];
  let nextId = 1;
  const id = () => `id_${nextId++}`;

  const db = {
    config: {
      findFirst: async ({ where, orderBy }: any) => {
        let rows = configRows.filter((r) => r.key === where.key);
        if (where.effectiveAt?.lte) rows = rows.filter((r) => r.effectiveAt.getTime() <= where.effectiveAt.lte.getTime());
        rows.sort((a, b) => (orderBy?.version === "desc" ? b.version - a.version : a.version - b.version));
        return rows[0] ?? null;
      },
      create: async ({ data }: any) => {
        const row = { id: id(), createdAt: new Date(), ...data };
        configRows.push(row);
        return row;
      },
    },
    category: {
      findMany: async () => [...categories.values()].sort((a, b) => a.name.localeCompare(b.name)),
      findUnique: async ({ where }: any) => categories.get(where.id) ?? null,
      create: async ({ data }: any) => {
        const c = { id: id(), isActive: true, ...data };
        categories.set(c.id, c);
        return c;
      },
      update: async ({ where, data }: any) => {
        const updated = { ...categories.get(where.id), ...data };
        categories.set(where.id, updated);
        return updated;
      },
    },
    auditLog: {
      create: async ({ data }: any) => {
        const a = { id: id(), createdAt: new Date(), ...data };
        auditLog.push(a);
        return a;
      },
    },
    __state: { configRows, categories, auditLog },
  };

  return db as unknown as PrismaClient & { __state: typeof db.__state };
}

const ADMIN_ID = "admin_1";

function seedConfig(prisma: ReturnType<typeof createFakePrisma>, key: string, value: unknown, version = 1) {
  prisma.__state.configRows.push({ id: `seed_${key}`, key, value, version, effectiveAt: new Date(0), createdAt: new Date() });
}

describe("admin config — getConfig", () => {
  it("reads the currently-effective value of every managed key, plus every category", async () => {
    const prisma = createFakePrisma();
    seedConfig(prisma, "commission_rate.pickup", 5);
    seedConfig(prisma, "commission_rate.delivery", 10);
    seedConfig(prisma, "vendor_accept_window_minutes", 15);
    seedConfig(prisma, "flat_delivery_fee_minor", 50000);
    seedConfig(prisma, "founding_vendor_program_active", true);
    seedConfig(prisma, "founding_vendor_program_waiver_months", 3);
    prisma.__state.categories.set("cat_1", { id: "cat_1", name: "Food", defaultPrepMinutes: 20, isActive: true });

    const svc = createAdminConfigService({ prisma });
    const config = await svc.getConfig();

    expect(config.commissionRatePickup).toBe(5);
    expect(config.commissionRateDelivery).toBe(10);
    expect(config.foundingVendorProgramActive).toBe(true);
    expect(config.categories).toHaveLength(1);
  });
});

describe("admin config — updateConfig", () => {
  it("writes only the supplied keys, each as a new higher-versioned row, never mutating the old one", async () => {
    const prisma = createFakePrisma();
    seedConfig(prisma, "commission_rate.pickup", 5, 1);
    seedConfig(prisma, "commission_rate.delivery", 10, 1);

    const svc = createAdminConfigService({ prisma });
    const updated = await svc.updateConfig(ADMIN_ID, { commissionRatePickup: 7 });

    expect(updated.commissionRatePickup).toBe(7);
    expect(updated.commissionRateDelivery).toBe(10); // untouched

    const pickupRows = prisma.__state.configRows.filter((r) => r.key === "commission_rate.pickup");
    expect(pickupRows).toHaveLength(2); // the original v1 plus the new v2 — never overwritten
    expect(pickupRows.find((r) => r.version === 1)?.value).toBe(5); // old row intact
    expect(pickupRows.find((r) => r.version === 2)?.value).toBe(7);
  });

  it("writes an audit log entry for each key it actually changes", async () => {
    const prisma = createFakePrisma();
    seedConfig(prisma, "vendor_accept_window_minutes", 15, 1);

    const svc = createAdminConfigService({ prisma });
    await svc.updateConfig(ADMIN_ID, { vendorAcceptWindowMinutes: 20, foundingVendorProgramActive: false });

    expect(prisma.__state.auditLog).toHaveLength(2);
    expect(prisma.__state.auditLog.every((e: any) => e.action === "config_updated")).toBe(true);
  });

  it("touches nothing when no fields are present", async () => {
    const prisma = createFakePrisma();
    seedConfig(prisma, "commission_rate.pickup", 5, 1);

    const svc = createAdminConfigService({ prisma });
    await svc.updateConfig(ADMIN_ID, {});

    expect(prisma.__state.configRows).toHaveLength(1); // still just the seed
    expect(prisma.__state.auditLog).toHaveLength(0);
  });
});

describe("admin config — categories", () => {
  it("creates a category and logs it", async () => {
    const prisma = createFakePrisma();
    const svc = createAdminConfigService({ prisma });

    const category = await svc.createCategory(ADMIN_ID, { name: "Pharmacy", defaultPrepMinutes: 15 });

    expect((category as any).name).toBe("Pharmacy");
    expect((category as any).isActive).toBe(true);
    expect(prisma.__state.auditLog[0].action).toBe("category_created");
  });

  it("renames a category", async () => {
    const prisma = createFakePrisma();
    prisma.__state.categories.set("cat_1", { id: "cat_1", name: "Food", defaultPrepMinutes: 20, isActive: true });
    const svc = createAdminConfigService({ prisma });

    const updated = await svc.updateCategory(ADMIN_ID, "cat_1", { name: "Food & Groceries" });

    expect((updated as any).name).toBe("Food & Groceries");
    expect(prisma.__state.auditLog[0].action).toBe("category_updated");
  });

  it("deactivates a category without deleting it", async () => {
    const prisma = createFakePrisma();
    prisma.__state.categories.set("cat_1", { id: "cat_1", name: "Food", defaultPrepMinutes: 20, isActive: true });
    const svc = createAdminConfigService({ prisma });

    const updated = await svc.updateCategory(ADMIN_ID, "cat_1", { isActive: false });

    expect((updated as any).isActive).toBe(false);
    expect(prisma.__state.categories.has("cat_1")).toBe(true); // still there, just inactive
    expect(prisma.__state.auditLog[0].action).toBe("category_deactivated");
  });

  it("throws for a nonexistent category", async () => {
    const prisma = createFakePrisma();
    const svc = createAdminConfigService({ prisma });
    await expect(svc.updateCategory(ADMIN_ID, "nope", { name: "x" })).rejects.toThrow(CategoryNotFoundError);
  });
});

describe("admin config — rider cash float limit (US-R-08)", () => {
  it("shows the enforced default when no limit has ever been set, rather than a blank", async () => {
    const prisma = createFakePrisma();
    const svc = createAdminConfigService({ prisma });

    const config = await svc.getConfig();
    expect(config.riderCashFloatLimitMinor).toBe(10_000_000);
  });

  it("writes a new versioned row when an admin sets it, and reads it back", async () => {
    const prisma = createFakePrisma();
    const svc = createAdminConfigService({ prisma });

    const updated = await svc.updateConfig(ADMIN_ID, { riderCashFloatLimitMinor: 5_000_000 });

    expect(updated.riderCashFloatLimitMinor).toBe(5_000_000);
    const rows = prisma.__state.configRows.filter((r) => r.key === "rider_cash_float_limit_minor");
    expect(rows).toHaveLength(1);
    expect(rows[0].version).toBe(1); // first ever row for this key — none was seeded
  });
});
