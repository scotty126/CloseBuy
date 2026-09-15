import { describe, it, expect, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  createCatalogService,
  VendorAlreadyExistsError,
  VendorNotFoundError,
  ProductNotFoundError,
} from "./service.js";

/**
 * Minimal in-memory fake covering exactly the Prisma surface the catalog
 * service uses (vendorProfile/product find/create/update, no real
 * relations) — enough to exercise real access-control logic without a
 * live Postgres instance.
 */
function createFakePrisma() {
  const vendors = new Map<string, any>();
  const products = new Map<string, any>();
  let nextId = 1;
  const id = () => `id_${nextId++}`;

  return {
    vendorProfile: {
      findUnique: async ({ where }: { where: { id?: string; userId?: string } }) => {
        if (where.id) return vendors.get(where.id) ?? null;
        if (where.userId) return [...vendors.values()].find((v) => v.userId === where.userId) ?? null;
        return null;
      },
      findMany: async ({ where }: { where?: { status?: string } } = {}) =>
        [...vendors.values()].filter((v) => !where?.status || v.status === where.status),
      create: async ({ data }: { data: any }) => {
        const vendor = { id: id(), status: "pending", ...data };
        vendors.set(vendor.id, vendor);
        return vendor;
      },
      update: async ({ where, data }: { where: { userId: string }; data: any }) => {
        const existing = [...vendors.values()].find((v) => v.userId === where.userId)!;
        const updated = { ...existing, ...data };
        vendors.set(existing.id, updated);
        return updated;
      },
    },
    product: {
      findUnique: async ({ where }: { where: { id: string } }) => products.get(where.id) ?? null,
      findMany: async ({ where }: { where: { vendorId: string } }) =>
        [...products.values()].filter((p) => p.vendorId === where.vendorId),
      create: async ({ data }: { data: any }) => {
        const product = { id: id(), isActive: true, ...data };
        products.set(product.id, product);
        return product;
      },
      update: async ({ where, data }: { where: { id: string }; data: any }) => {
        const existing = products.get(where.id)!;
        const updated = { ...existing, ...data };
        products.set(where.id, updated);
        return updated;
      },
    },
  } as unknown as PrismaClient;
}

const USER_A = "user_vendor_a";
const USER_B = "user_vendor_b";

const APPLICATION = {
  businessName: "Ada's Kitchen",
  categoryId: "cat_food",
  pickupLat: 6.5,
  pickupLng: 3.4,
  pickupLandmark: "Blue gate opposite the market",
  pickupPhone: "+2348012345678",
};

describe("catalog service", () => {
  let prisma: PrismaClient;

  beforeEach(() => {
    prisma = createFakePrisma();
  });

  it("submits a vendor application in pending status", async () => {
    const svc = createCatalogService(prisma);
    const vendor = await svc.submitApplication(USER_A, APPLICATION);

    expect(vendor.status).toBe("pending");
    expect(vendor.businessName).toBe("Ada's Kitchen");
  });

  it("rejects a second application from the same account", async () => {
    const svc = createCatalogService(prisma);
    await svc.submitApplication(USER_A, APPLICATION);

    await expect(svc.submitApplication(USER_A, APPLICATION)).rejects.toThrow(VendorAlreadyExistsError);
  });

  it("only surfaces approved vendors in search — pending ones are invisible", async () => {
    const svc = createCatalogService(prisma);
    await svc.submitApplication(USER_A, APPLICATION);

    const { vendors } = await svc.searchVendors({ limit: 20 } as any);
    expect(vendors).toHaveLength(0); // still pending, not approved
  });

  it("a vendor cannot edit another vendor's product (cross-tenant access control)", async () => {
    const svc = createCatalogService(prisma);
    const vendorA = await svc.submitApplication(USER_A, APPLICATION);
    await svc.submitApplication(USER_B, { ...APPLICATION, businessName: "Bello Stores" });

    const product = await svc.createProduct(USER_A, {
      categoryId: "cat_food",
      name: "Jollof rice",
      priceMinor: 250000,
      images: ["https://example.com/rice.jpg"],
      stock: 10,
    });
    expect(product.vendorId).toBe(vendorA.id);

    // Vendor B tries to edit vendor A's product — must fail, not silently succeed.
    await expect(
      svc.updateProduct(USER_B, product.id, { name: "Hijacked listing" }),
    ).rejects.toThrow(ProductNotFoundError);

    // Same for deactivation.
    await expect(svc.deactivateProduct(USER_B, product.id)).rejects.toThrow(ProductNotFoundError);
  });

  it("deactivates a product rather than deleting it (US-V-03)", async () => {
    const svc = createCatalogService(prisma);
    await svc.submitApplication(USER_A, APPLICATION);
    const product = await svc.createProduct(USER_A, {
      categoryId: "cat_food",
      name: "Suya",
      priceMinor: 150000,
      images: ["https://example.com/suya.jpg"],
      stock: 5,
    });

    await svc.deactivateProduct(USER_A, product.id);

    const stillThere = await prisma.product.findUnique({ where: { id: product.id } });
    expect(stillThere).not.toBeNull();
    expect((stillThere as any).isActive).toBe(false);
  });

  it("throws for an application submitted by an account with no vendor profile yet (product/profile edits)", async () => {
    const svc = createCatalogService(prisma);
    await expect(svc.getOwnVendorProfile("nobody")).rejects.toThrow(VendorNotFoundError);
    await expect(
      svc.createProduct("nobody", {
        categoryId: "cat_food",
        name: "Ghost product",
        priceMinor: 100,
        images: ["https://example.com/x.jpg"],
        stock: 1,
      }),
    ).rejects.toThrow(VendorNotFoundError);
  });
});
