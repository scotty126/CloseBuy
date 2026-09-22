import type { PrismaClient } from "@prisma/client";
import type {
  VendorApplicationInput,
  VendorUpdateInput,
  VendorSearchQuery,
  ProductCreateInput,
  ProductUpdateInput,
} from "@closebuy/types";
import { isWithinServiceArea } from "../../lib/geo.js";
import { omitFields } from "../../lib/redact.js";

// VendorDto (@closebuy/types) is the actual public contract — these
// fields exist on the Prisma row but were never meant to leave the
// service layer on the public browse/search/detail endpoints. Bank
// details are the sharp edge here (findable via a plain GET, no auth),
// but exact pickup coordinates and internal status/phone/timestamps
// don't belong on a public response either.
const PUBLIC_VENDOR_OMIT = [
  "userId",
  "categoryId",
  "pickupLat",
  "pickupLng",
  "pickupPhone",
  "bankAccountNumber",
  "bankCode",
  "bankAccountName",
  "status",
  "openingHours",
  "createdAt",
] as const;

export class VendorAlreadyExistsError extends Error {
  constructor() {
    super("This account has already submitted a vendor application.");
  }
}

export class OutsideServiceAreaError extends Error {
  constructor(message = "Sorry, we're only onboarding vendors in Riverpark for now.") {
    super(message);
  }
}

export class VendorNotFoundError extends Error {
  constructor() {
    super("Vendor not found.");
  }
}

export class ProductNotFoundError extends Error {
  constructor() {
    super("Product not found.");
  }
}

export function createCatalogService(prisma: PrismaClient) {
  return {
    listCategories: () => prisma.category.findMany({ where: { isActive: true } }),

    /**
     * US-C-02/03 — public browse/search. Only `approved` vendors are
     * returned at all (an unapproved one has never gone live, brief
     * US-V-01); `isOpen: false` vendors are still included but flagged, so
     * the client can grey them out rather than hide them entirely — either
     * is an allowed treatment per US-C-02's acceptance criteria.
     *
     * Known gap, not silently ignored: `lat`/`lng` are accepted (forward
     * compatible with api-contracts.md) but not yet used for
     * distance filtering/sorting — that needs either PostGIS or an
     * application-level haversine calculation, neither built yet. Filed as
     * a fast-follow, not pretended to work.
     */
    async searchVendors(query: VendorSearchQuery) {
      const vendors = await prisma.vendorProfile.findMany({
        where: {
          status: "approved",
          ...(query.category ? { categoryId: query.category } : {}),
          ...(query.fulfilment === "pickup" ? { supportsPickup: true } : {}),
          ...(query.q ? { businessName: { contains: query.q, mode: "insensitive" } } : {}),
        },
        include: { category: true },
        take: query.limit,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
        orderBy: { businessName: "asc" },
      });

      const nextCursor = vendors.length === query.limit ? vendors[vendors.length - 1]?.id : undefined;
      return { vendors: vendors.map((v) => omitFields(v, [...PUBLIC_VENDOR_OMIT])), nextCursor };
    },

    async getVendor(vendorId: string) {
      const vendor = await prisma.vendorProfile.findUnique({
        where: { id: vendorId },
        include: { category: true },
      });
      if (!vendor || vendor.status !== "approved") throw new VendorNotFoundError();
      return omitFields(vendor, [...PUBLIC_VENDOR_OMIT]);
    },

    async getVendorProducts(vendorId: string) {
      return prisma.product.findMany({
        where: { vendorId, isActive: true },
        orderBy: { name: "asc" },
      });
    },

    /** US-V-01 — the applicant is already an authenticated `vendor`-role User (phone OTP); this creates the VendorProfile itself, in `pending`. */
    async submitApplication(userId: string, input: VendorApplicationInput) {
      const existing = await prisma.vendorProfile.findUnique({ where: { userId } });
      if (existing) throw new VendorAlreadyExistsError();

      if (!(await isWithinServiceArea(prisma, input.pickupLat, input.pickupLng))) {
        throw new OutsideServiceAreaError(); // brief §2a — launch is Riverpark only, same check checkout uses
      }

      return prisma.vendorProfile.create({
        data: {
          userId,
          businessName: input.businessName,
          categoryId: input.categoryId,
          description: input.description,
          pickupLat: input.pickupLat,
          pickupLng: input.pickupLng,
          pickupLandmark: input.pickupLandmark,
          pickupPhone: input.pickupPhone,
          bankAccountNumber: input.bankAccountNumber,
          bankCode: input.bankCode,
          bankAccountName: input.bankAccountName,
          status: "pending",
          openingHours: {},
        },
      });
    },

    async getOwnVendorProfile(userId: string) {
      const vendor = await prisma.vendorProfile.findUnique({ where: { userId } });
      if (!vendor) throw new VendorNotFoundError();
      return vendor;
    },

    /**
     * US-V-03/04 — the vendor's own product list, active AND inactive
     * (screens-navigation.md §2.2 needs both, with a state indicator) —
     * unlike `getVendorProducts` above (public, active-only, gates on the
     * vendor being `approved` too).
     */
    async getOwnVendorProducts(userId: string) {
      const vendor = await prisma.vendorProfile.findUnique({ where: { userId } });
      if (!vendor) throw new VendorNotFoundError();
      return prisma.product.findMany({ where: { vendorId: vendor.id }, orderBy: { name: "asc" } });
    },

    /**
     * US-V-02 — editable regardless of application status (a pending
     * vendor can still prepare their storefront); only `searchVendors`/
     * `getVendor` above gate on `status: approved` for customer-facing
     * visibility. Deliberately not the same gate applied twice.
     */
    async updateOwnVendorProfile(userId: string, input: VendorUpdateInput) {
      const vendor = await prisma.vendorProfile.findUnique({ where: { userId } });
      if (!vendor) throw new VendorNotFoundError();

      return prisma.vendorProfile.update({ where: { userId }, data: input });
    },

    /** US-V-03 */
    async createProduct(userId: string, input: ProductCreateInput) {
      const vendor = await prisma.vendorProfile.findUnique({ where: { userId } });
      if (!vendor) throw new VendorNotFoundError();

      return prisma.product.create({ data: { ...input, vendorId: vendor.id } });
    },

    /** US-V-03 — price edits never touch past OrderItem snapshots; that's structural (OrderItem copies name/priceMinor at purchase time), not enforced here. */
    async updateProduct(userId: string, productId: string, input: ProductUpdateInput) {
      const vendor = await prisma.vendorProfile.findUnique({ where: { userId } });
      if (!vendor) throw new VendorNotFoundError();

      const product = await prisma.product.findUnique({ where: { id: productId } });
      if (!product || product.vendorId !== vendor.id) throw new ProductNotFoundError();

      return prisma.product.update({ where: { id: productId }, data: input });
    },

    /** US-V-03 — deactivate, never hard-delete (order history references it). */
    async deactivateProduct(userId: string, productId: string) {
      const vendor = await prisma.vendorProfile.findUnique({ where: { userId } });
      if (!vendor) throw new VendorNotFoundError();

      const product = await prisma.product.findUnique({ where: { id: productId } });
      if (!product || product.vendorId !== vendor.id) throw new ProductNotFoundError();

      return prisma.product.update({ where: { id: productId }, data: { isActive: false } });
    },
  };
}

export type CatalogService = ReturnType<typeof createCatalogService>;
