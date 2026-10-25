import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createCatalogService, discountPercent, InvalidSalePriceError, ProductNotFoundError } from "./service.js";

/**
 * Separate from service.test.ts: that file's fake only evaluates the shapes
 * the vendor-facing methods build. Deals/search need product.findMany to
 * honour a different where-clause, and a bespoke fake here is clearer than
 * bolting a second evaluator onto the first.
 */
function product(over: Record<string, unknown>) {
  return {
    id: "p",
    vendorId: "v1",
    categoryId: "c",
    name: "Thing",
    description: null,
    priceMinor: 1000,
    compareAtPriceMinor: null,
    images: [],
    stock: 5,
    isActive: true,
    isQuickBuy: false,
    vendor: { businessName: "Mama Nkechi", isOpen: true, supportsPickup: false, avgDeliveryMinutes: 20 },
    ...over,
  };
}

function fakePrisma(rows: any[]) {
  const seen: any[] = [];
  const db = {
    product: {
      findMany: async (args: any) => {
        seen.push(args);
        return rows.filter((r) => {
          const w = args.where;
          if (w.compareAtPriceMinor?.not === null && r.compareAtPriceMinor == null) return false;
          if (w.stock?.gt !== undefined && !(r.stock > w.stock.gt)) return false;
          if (w.priceMinor?.lte !== undefined && r.priceMinor > w.priceMinor.lte) return false;
          if (w.OR) {
            const hit = w.OR.some((c: any) =>
              c.name
                ? r.name.toLowerCase().includes(c.name.contains.toLowerCase())
                : r.vendor.businessName.toLowerCase().includes(c.vendor.businessName.contains.toLowerCase()),
            );
            if (!hit) return false;
          }
          return true;
        });
      },
    },
    vendorProfile: { findUnique: async () => ({ id: "v1", userId: "u1" }) },
    __seen: seen,
  };
  return db as unknown as PrismaClient & { __seen: any[] };
}

describe("discountPercent", () => {
  it("is the rounded markdown off the was-price", () => {
    expect(discountPercent({ priceMinor: 8100, compareAtPriceMinor: 9500 })).toBe(15);
  });
  it("is 0 when there is no was-price", () => {
    expect(discountPercent({ priceMinor: 8100, compareAtPriceMinor: null })).toBe(0);
  });
  it("is 0 when the was-price is not actually higher — never a fake discount", () => {
    expect(discountPercent({ priceMinor: 9500, compareAtPriceMinor: 9500 })).toBe(0);
    expect(discountPercent({ priceMinor: 9500, compareAtPriceMinor: 9000 })).toBe(0);
  });
});

describe("listDeals", () => {
  it("returns only genuinely discounted, in-stock products, biggest discount first", async () => {
    const svc = createCatalogService(
      fakePrisma([
        product({ id: "small", priceMinor: 900, compareAtPriceMinor: 1000 }),
        product({ id: "big", priceMinor: 500, compareAtPriceMinor: 1000 }),
        product({ id: "bogus", priceMinor: 1000, compareAtPriceMinor: 800 }),
        product({ id: "none" }),
        product({ id: "sold-out", priceMinor: 100, compareAtPriceMinor: 1000, stock: 0 }),
      ]),
    );
    const deals = await svc.listDeals(10);
    expect(deals.map((d) => d.id)).toEqual(["big", "small"]);
  });

  it("attaches the vendor fields a card needs and strips the nested relation", async () => {
    const svc = createCatalogService(fakePrisma([product({ id: "a", priceMinor: 500, compareAtPriceMinor: 1000 })]));
    const [deal] = await svc.listDeals(10);
    expect(deal).toMatchObject({ vendorName: "Mama Nkechi", vendorIsOpen: true, avgDeliveryMinutes: 20 });
    expect(deal).not.toHaveProperty("vendor");
  });

  it("respects the limit", async () => {
    const rows = [1, 2, 3].map((n) => product({ id: `p${n}`, priceMinor: 100 * n, compareAtPriceMinor: 1000 }));
    expect(await createCatalogService(fakePrisma(rows)).listDeals(2)).toHaveLength(2);
  });
});

describe("searchProducts", () => {
  const rows = [
    product({ id: "rice", name: "Long grain rice", priceMinor: 8100, compareAtPriceMinor: 9500 }),
    product({ id: "eggs", name: "Fresh eggs", priceMinor: 3000 }),
    product({ id: "malt", name: "Malt drink", priceMinor: 3600, vendor: { businessName: "Chill Spot", isOpen: false, supportsPickup: true, avgDeliveryMinutes: null } }),
  ];

  it("matches on the product name", async () => {
    const out = await createCatalogService(fakePrisma(rows)).searchProducts({ q: "rice", limit: 30 });
    expect(out.map((p) => p.id)).toEqual(["rice"]);
  });

  it("matches on the vendor name too", async () => {
    const out = await createCatalogService(fakePrisma(rows)).searchProducts({ q: "chill", limit: 30 });
    expect(out.map((p) => p.id)).toEqual(["malt"]);
  });

  it("applies the price cap", async () => {
    const out = await createCatalogService(fakePrisma(rows)).searchProducts({ maxPriceMinor: 5000, limit: 30 });
    expect(out.map((p) => p.id).sort()).toEqual(["eggs", "malt"]);
  });

  it("onSale drops anything without a real markdown", async () => {
    const out = await createCatalogService(fakePrisma(rows)).searchProducts({ onSale: true, limit: 30 });
    expect(out.map((p) => p.id)).toEqual(["rice"]);
  });

  it("openNow narrows the query to open vendors", async () => {
    const prisma = fakePrisma(rows);
    await createCatalogService(prisma).searchProducts({ openNow: true, limit: 30 });
    expect(prisma.__seen[0].where.vendor).toEqual({ status: "approved", isOpen: true });
  });

  it("always scopes to active products of approved vendors", async () => {
    const prisma = fakePrisma(rows);
    await createCatalogService(prisma).searchProducts({ limit: 30 });
    expect(prisma.__seen[0].where).toMatchObject({ isActive: true, vendor: { status: "approved" } });
  });
});

describe("sale price validation", () => {
  const input = { categoryId: "c", name: "Rice", priceMinor: 8100, images: ["https://x.test/a.jpg"], stock: 1 };

  function writable() {
    const created: any[] = [];
    const prisma = {
      vendorProfile: { findUnique: async () => ({ id: "v1", userId: "u1" }) },
      product: {
        create: async ({ data }: any) => {
          created.push(data);
          return { id: "new", ...data };
        },
        findUnique: async () => ({ id: "p1", vendorId: "v1", priceMinor: 8100, compareAtPriceMinor: 9500 }),
        update: async ({ data }: any) => ({ id: "p1", ...data }),
      },
    } as unknown as PrismaClient;
    return { svc: createCatalogService(prisma), created };
  }

  it("accepts a was-price above the selling price", async () => {
    const { svc, created } = writable();
    await svc.createProduct("u1", { ...input, compareAtPriceMinor: 9500 });
    expect(created[0].compareAtPriceMinor).toBe(9500);
  });

  it("rejects a was-price at or below the selling price on create", async () => {
    const { svc } = writable();
    await expect(svc.createProduct("u1", { ...input, compareAtPriceMinor: 8100 })).rejects.toBeInstanceOf(InvalidSalePriceError);
    await expect(svc.createProduct("u1", { ...input, compareAtPriceMinor: 5000 })).rejects.toBeInstanceOf(InvalidSalePriceError);
  });

  it("an update that only raises the price is checked against the stored was-price", async () => {
    const { svc } = writable();
    // stored was-price is 9500; raising the price to 9600 would leave a fake "sale"
    await expect(svc.updateProduct("u1", "p1", { priceMinor: 9600 })).rejects.toBeInstanceOf(InvalidSalePriceError);
  });

  it("an update can clear the sale with null", async () => {
    const { svc } = writable();
    await expect(svc.updateProduct("u1", "p1", { priceMinor: 9600, compareAtPriceMinor: null })).resolves.toBeTruthy();
  });
});

describe("getProduct", () => {
  const rows = [
    product({ id: "rice", vendorId: "v1", name: "Rice" }),
    product({ id: "oil", vendorId: "v1", name: "Oil" }),
    product({ id: "sold-out", vendorId: "v1", name: "Gone", stock: 0 }),
    product({ id: "other-shop", vendorId: "v2", name: "Elsewhere" }),
    product({ id: "retired", vendorId: "v1", name: "Retired", isActive: false }),
  ];

  // getProduct's where-clauses (id / vendorId / id.not / isActive) — evaluated here, not in the shared fake above.
  function prismaWithIds() {
    const base = fakePrisma(rows) as any;
    base.product.findMany = async ({ where: w, take }: any) =>
      rows
        .filter((r) => {
          if (w.isActive !== undefined && r.isActive !== w.isActive) return false;
          if (typeof w.id === "string" && r.id !== w.id) return false;
          if (w.id?.not && r.id === w.id.not) return false;
          if (w.vendorId && r.vendorId !== w.vendorId) return false;
          if (w.stock?.gt !== undefined && !(r.stock > w.stock.gt)) return false;
          return true;
        })
        .slice(0, take);
    return base as PrismaClient;
  }

  it("returns the product with its vendor fields", async () => {
    const out = await createCatalogService(prismaWithIds()).getProduct("rice");
    expect(out.product).toMatchObject({ id: "rice", vendorName: "Mama Nkechi" });
  });

  it("suggests only in-stock, active products from the same vendor, never the product itself", async () => {
    const out = await createCatalogService(prismaWithIds()).getProduct("rice");
    expect(out.pairsWith.map((p) => p.id)).toEqual(["oil"]);
  });

  it("404s for an inactive product", async () => {
    await expect(createCatalogService(prismaWithIds()).getProduct("retired")).rejects.toBeInstanceOf(ProductNotFoundError);
  });

  it("404s for an unknown id", async () => {
    await expect(createCatalogService(prismaWithIds()).getProduct("nope")).rejects.toBeInstanceOf(ProductNotFoundError);
  });
});

describe("getVendorRatingDistribution", () => {
  it("counts each star level, zero-filling the rest", async () => {
    const prisma = {
      rating: {
        groupBy: async () => [
          { score: 5, _count: { score: 7 } },
          { score: 4, _count: { score: 2 } },
          { score: 1, _count: { score: 1 } },
        ],
      },
    } as unknown as PrismaClient;
    expect(await createCatalogService(prisma).getVendorRatingDistribution("v1")).toEqual({ 1: 1, 2: 0, 3: 0, 4: 2, 5: 7 });
  });

  it("ignores out-of-range scores rather than throwing", async () => {
    const prisma = { rating: { groupBy: async () => [{ score: 9, _count: { score: 3 } }] } } as unknown as PrismaClient;
    expect(await createCatalogService(prisma).getVendorRatingDistribution("v1")).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
  });
});
