import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createFavoritesService, FavoriteProductNotFoundError, FollowVendorNotFoundError } from "./service.js";

function fakePrisma(opts: { products?: Record<string, { isActive: boolean }>; vendors?: Record<string, { status: string }> } = {}) {
  const favs: { customerId: string; productId: string; createdAt: number; product: any }[] = [];
  const follows: { customerId: string; vendorId: string }[] = [];
  let tick = 0;
  const listingProduct = (id: string) => ({
    id,
    vendorId: "v1",
    priceMinor: 100,
    compareAtPriceMinor: null,
    images: [],
    stock: 1,
    isActive: true,
    vendor: { businessName: "Shop", isOpen: true, supportsPickup: false, avgDeliveryMinutes: null },
  });
  const db = {
    product: { findUnique: async ({ where }: any) => opts.products?.[where.id] ?? null },
    vendorProfile: { findUnique: async ({ where }: any) => opts.vendors?.[where.id] ?? null },
    productFavorite: {
      upsert: async ({ create }: any) => {
        if (!favs.some((f) => f.customerId === create.customerId && f.productId === create.productId)) {
          favs.push({ ...create, createdAt: tick++, product: listingProduct(create.productId) });
        }
      },
      deleteMany: async ({ where }: any) => {
        for (let i = favs.length - 1; i >= 0; i--) {
          if (favs[i]!.customerId === where.customerId && favs[i]!.productId === where.productId) favs.splice(i, 1);
        }
      },
      findMany: async ({ where }: any) =>
        favs
          .filter((f) => f.customerId === where.customerId)
          .sort((a, b) => b.createdAt - a.createdAt)
          .map((f) => ({ ...f })),
    },
    vendorFollow: {
      upsert: async ({ create }: any) => {
        if (!follows.some((f) => f.customerId === create.customerId && f.vendorId === create.vendorId)) follows.push(create);
      },
      deleteMany: async ({ where }: any) => {
        for (let i = follows.length - 1; i >= 0; i--) {
          if (follows[i]!.customerId === where.customerId && follows[i]!.vendorId === where.vendorId) follows.splice(i, 1);
        }
      },
      findMany: async ({ where }: any) => follows.filter((f) => f.customerId === where.customerId).map((f) => ({ vendorId: f.vendorId })),
    },
    __favs: favs,
    __follows: follows,
  };
  return db as unknown as PrismaClient & { __favs: typeof favs; __follows: typeof follows };
}

describe("favourite products", () => {
  it("saves an active product", async () => {
    const prisma = fakePrisma({ products: { p1: { isActive: true } } });
    await createFavoritesService(prisma).add("c1", "p1");
    expect(prisma.__favs).toHaveLength(1);
  });

  it("is idempotent — saving twice keeps one row", async () => {
    const prisma = fakePrisma({ products: { p1: { isActive: true } } });
    const svc = createFavoritesService(prisma);
    await svc.add("c1", "p1");
    await svc.add("c1", "p1");
    expect(prisma.__favs).toHaveLength(1);
  });

  it("refuses an unknown or inactive product", async () => {
    const prisma = fakePrisma({ products: { gone: { isActive: false } } });
    const svc = createFavoritesService(prisma);
    await expect(svc.add("c1", "gone")).rejects.toBeInstanceOf(FavoriteProductNotFoundError);
    await expect(svc.add("c1", "nope")).rejects.toBeInstanceOf(FavoriteProductNotFoundError);
  });

  it("removes, and removing something not saved is fine", async () => {
    const prisma = fakePrisma({ products: { p1: { isActive: true } } });
    const svc = createFavoritesService(prisma);
    await svc.add("c1", "p1");
    await svc.remove("c1", "p1");
    await svc.remove("c1", "p1");
    expect(prisma.__favs).toHaveLength(0);
  });

  it("lists newest first, only the caller's own, as listings", async () => {
    const prisma = fakePrisma({ products: { a: { isActive: true }, b: { isActive: true } } });
    const svc = createFavoritesService(prisma);
    await svc.add("c1", "a");
    await svc.add("c1", "b");
    await svc.add("someone-else", "a");
    const list = await svc.list("c1");
    expect(list.map((p) => p.id)).toEqual(["b", "a"]);
    expect(list[0]).toMatchObject({ vendorName: "Shop" });
    expect(list[0]).not.toHaveProperty("vendor");
  });
});

describe("followed shops", () => {
  it("follows an approved shop, idempotently", async () => {
    const prisma = fakePrisma({ vendors: { v1: { status: "approved" } } });
    const svc = createFavoritesService(prisma);
    await svc.followVendor("c1", "v1");
    await svc.followVendor("c1", "v1");
    expect(await svc.followedVendorIds("c1")).toEqual(["v1"]);
  });

  it("refuses a pending, suspended or unknown shop", async () => {
    const prisma = fakePrisma({ vendors: { pending: { status: "pending" }, banned: { status: "suspended" } } });
    const svc = createFavoritesService(prisma);
    await expect(svc.followVendor("c1", "pending")).rejects.toBeInstanceOf(FollowVendorNotFoundError);
    await expect(svc.followVendor("c1", "banned")).rejects.toBeInstanceOf(FollowVendorNotFoundError);
    await expect(svc.followVendor("c1", "nope")).rejects.toBeInstanceOf(FollowVendorNotFoundError);
  });

  it("unfollows, and each customer only sees their own follows", async () => {
    const prisma = fakePrisma({ vendors: { v1: { status: "approved" } } });
    const svc = createFavoritesService(prisma);
    await svc.followVendor("c1", "v1");
    await svc.followVendor("c2", "v1");
    await svc.unfollowVendor("c1", "v1");
    expect(await svc.followedVendorIds("c1")).toEqual([]);
    expect(await svc.followedVendorIds("c2")).toEqual(["v1"]);
  });
});
