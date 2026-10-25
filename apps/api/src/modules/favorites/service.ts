import type { PrismaClient } from "@prisma/client";
import type { ProductListingDto } from "@closebuy/types";
import { toListing } from "../catalog/service.js";

export class FavoriteProductNotFoundError extends Error {
  constructor() {
    super("That product isn't available.");
  }
}

export class FollowVendorNotFoundError extends Error {
  constructor() {
    super("That shop isn't available.");
  }
}

export function createFavoritesService(prisma: PrismaClient) {
  return {
    /** Newest saved first. A product that's since gone inactive (or its vendor suspended) drops out rather than showing as a dead card. */
    async list(customerId: string): Promise<ProductListingDto[]> {
      const rows = await prisma.productFavorite.findMany({
        where: { customerId, product: { isActive: true, vendor: { status: "approved" } } },
        include: {
          product: { include: { vendor: { select: { businessName: true, isOpen: true, supportsPickup: true, avgDeliveryMinutes: true } } } },
        },
        orderBy: { createdAt: "desc" },
      });
      return rows.map((f) => toListing(f.product));
    },

    /** Idempotent — saving something already saved is a no-op, not an error. */
    async add(customerId: string, productId: string) {
      const product = await prisma.product.findUnique({ where: { id: productId }, select: { isActive: true } });
      if (!product?.isActive) throw new FavoriteProductNotFoundError();
      await prisma.productFavorite.upsert({
        where: { customerId_productId: { customerId, productId } },
        create: { customerId, productId },
        update: {},
      });
    },

    /** Idempotent — removing something not saved is fine too. */
    async remove(customerId: string, productId: string) {
      await prisma.productFavorite.deleteMany({ where: { customerId, productId } });
    },

    /** Ids only — the storefront just needs to know whether its own heart is filled. */
    async followedVendorIds(customerId: string): Promise<string[]> {
      const rows = await prisma.vendorFollow.findMany({ where: { customerId }, select: { vendorId: true } });
      return rows.map((r) => r.vendorId);
    },

    /** Idempotent. Only an approved shop can be followed — same visibility rule as the public storefront. */
    async followVendor(customerId: string, vendorId: string) {
      const vendor = await prisma.vendorProfile.findUnique({ where: { id: vendorId }, select: { status: true } });
      if (vendor?.status !== "approved") throw new FollowVendorNotFoundError();
      await prisma.vendorFollow.upsert({
        where: { customerId_vendorId: { customerId, vendorId } },
        create: { customerId, vendorId },
        update: {},
      });
    },

    async unfollowVendor(customerId: string, vendorId: string) {
      await prisma.vendorFollow.deleteMany({ where: { customerId, vendorId } });
    },
  };
}
