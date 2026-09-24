import type { PrismaClient } from "@prisma/client";
import type { ConfigUpdateInput, CategoryCreateInput, CategoryUpdateInput } from "@closebuy/types";

/**
 * US-A-02 — config writes. Own module, same precedent as ./orders.js,
 * ./disputes.js and ./actors.js: touches prisma.config/category directly
 * rather than reaching into lib/config.ts (that file is a read-only,
 * typed-accessor layer for Order/Payments — ConfigKeys.commissionRatePickup
 * and friends — this is the write side those accessors were always
 * waiting on).
 */

export class CategoryNotFoundError extends Error {
  constructor() {
    super("Category not found.");
  }
}

export interface AdminConfigServiceDeps {
  prisma: PrismaClient;
}

// Maps PATCH /admin/config's wire field names to the raw Config.key
// strings lib/config.ts's ConfigKeys reads — kept local since this is the
// only place that ever writes them.
const CONFIG_KEYS = {
  commissionRatePickup: "commission_rate.pickup",
  commissionRateDelivery: "commission_rate.delivery",
  vendorAcceptWindowMinutes: "vendor_accept_window_minutes",
  flatDeliveryFeeMinor: "flat_delivery_fee_minor",
  foundingVendorProgramActive: "founding_vendor_program_active",
  foundingVendorProgramWaiverMonths: "founding_vendor_program_waiver_months",
} as const;

export function createAdminConfigService({ prisma }: AdminConfigServiceDeps) {
  async function writeAuditLog(actorId: string, action: string, targetType: string, targetId: string, reason?: string) {
    await prisma.auditLog.create({ data: { actorId, action, targetType, targetId, reason } });
  }

  // Same read lib/config.ts's getConfigValue does — the currently-effective
  // row, highest version with effectiveAt <= now. Undefined (not thrown)
  // if a key has genuinely never been seeded, since GET /admin/config
  // should render an empty field rather than 500 on a missing key.
  async function readConfigValue<T>(key: string): Promise<T | undefined> {
    const row = await prisma.config.findFirst({
      where: { key, effectiveAt: { lte: new Date() } },
      orderBy: { version: "desc" },
    });
    return row?.value as T | undefined;
  }

  // Never UPDATEs a row — UPDATE is revoked on `config` at the DB grant
  // (prisma/APPEND_ONLY.sql). Always a new, higher-versioned row, effective
  // immediately; an order that already reached COMPLETED already has its
  // own commissionMinor stored on the Order row itself, so a later config
  // change can never retroactively alter it (US-A-02's "never alters
  // orders already placed").
  async function writeConfigValue(key: string, value: unknown) {
    const latest = await prisma.config.findFirst({ where: { key }, orderBy: { version: "desc" } });
    const version = (latest?.version ?? 0) + 1;
    await prisma.config.create({ data: { key, value: value as any, version, effectiveAt: new Date() } });
  }

  async function getConfig() {
    const [
      commissionRatePickup,
      commissionRateDelivery,
      vendorAcceptWindowMinutes,
      flatDeliveryFeeMinor,
      foundingVendorProgramActive,
      foundingVendorProgramWaiverMonths,
      categories,
    ] = await Promise.all([
      readConfigValue<number>(CONFIG_KEYS.commissionRatePickup),
      readConfigValue<number>(CONFIG_KEYS.commissionRateDelivery),
      readConfigValue<number>(CONFIG_KEYS.vendorAcceptWindowMinutes),
      readConfigValue<number>(CONFIG_KEYS.flatDeliveryFeeMinor),
      readConfigValue<boolean>(CONFIG_KEYS.foundingVendorProgramActive),
      readConfigValue<number>(CONFIG_KEYS.foundingVendorProgramWaiverMonths),
      prisma.category.findMany({ orderBy: { name: "asc" } }),
    ]);

    return {
      commissionRatePickup,
      commissionRateDelivery,
      vendorAcceptWindowMinutes,
      flatDeliveryFeeMinor,
      foundingVendorProgramActive,
      foundingVendorProgramWaiverMonths,
      categories,
    };
  }

  return {
    /** US-A-02 — the current live value of everything this screen manages. */
    getConfig,

    /** US-A-02 — PATCH semantics: only the keys actually present in the input get written, each its own new versioned row. */
    async updateConfig(adminUserId: string, input: ConfigUpdateInput) {
      for (const field of Object.keys(CONFIG_KEYS) as (keyof typeof CONFIG_KEYS)[]) {
        const value = input[field];
        if (value === undefined) continue;
        const key = CONFIG_KEYS[field];
        await writeConfigValue(key, value);
        await writeAuditLog(adminUserId, "config_updated", "config", key, `${key} -> ${JSON.stringify(value)}`);
      }
      return getConfig();
    },

    /** US-A-02 — categories are a real table (product/vendor foreign keys point at them), not a Config key. */
    async createCategory(adminUserId: string, input: CategoryCreateInput) {
      const category = await prisma.category.create({ data: { name: input.name, defaultPrepMinutes: input.defaultPrepMinutes } });
      await writeAuditLog(adminUserId, "category_created", "category", category.id, input.name);
      return category;
    },

    /** US-A-02 — rename, re-time prep, and/or deactivate/reactivate. Deactivating never hard-deletes (products/vendors still reference it). */
    async updateCategory(adminUserId: string, id: string, input: CategoryUpdateInput) {
      const existing = await prisma.category.findUnique({ where: { id } });
      if (!existing) throw new CategoryNotFoundError();

      const updated = await prisma.category.update({ where: { id }, data: input });
      const action = input.isActive === false ? "category_deactivated" : input.isActive === true ? "category_reactivated" : "category_updated";
      await writeAuditLog(adminUserId, action, "category", id, JSON.stringify(input));
      return updated;
    },
  };
}

export type AdminConfigService = ReturnType<typeof createAdminConfigService>;
