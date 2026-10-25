import type { PrismaClient } from "@prisma/client";
import type {
  VendorApplicationInput,
  VendorUpdateInput,
  VendorSearchQuery,
  ProductCreateInput,
  ProductUpdateInput,
  ProductSearchQuery,
  ProductListingDto,
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
  "createdAt",
  // US-C-10 — an internal ops metric (only ever decremented on a vendor's
  // own auto-reject/reject, order/service.ts), never a customer rating.
  // Was being shown to customers as if it were one before real ratings
  // existed anywhere; ratingAverage/ratingCount below are the real thing.
  // Still exposed on OwnVendorProfileDto (the vendor's own view) and to
  // admin — just not here.
  "reliabilityScore",
] as const;

/** US-C-10 — "vendor rating is displayed as an average with a count." One groupBy for the whole search-result page rather than one query per vendor. */
async function vendorRatingSummaries(prisma: PrismaClient, vendorIds: string[]) {
  if (vendorIds.length === 0) return new Map<string, { average: number; count: number }>();
  const grouped = await prisma.rating.groupBy({
    by: ["targetId"],
    where: { targetType: "vendor", targetId: { in: vendorIds } },
    _avg: { score: true },
    _count: { targetId: true },
  });
  return new Map(grouped.map((g) => [g.targetId, { average: g._avg.score ?? 0, count: g._count.targetId }]));
}

function withRatingSummary<T extends { id: string }>(vendor: T, summary: { average: number; count: number } | undefined) {
  return {
    ...vendor,
    ratingAverage: summary ? Math.round(summary.average * 10) / 10 : null,
    ratingCount: summary?.count ?? 0,
  };
}

export class InvalidSalePriceError extends Error {
  constructor() {
    super("The original price must be higher than the selling price.");
  }
}

/** The "was" price has to actually be a markdown — anything else would render a fake discount. */
function assertValidSalePrice(priceMinor: number, compareAtPriceMinor: number | null | undefined) {
  if (compareAtPriceMinor != null && compareAtPriceMinor <= priceMinor) throw new InvalidSalePriceError();
}

const LISTING_INCLUDE = {
  vendor: { select: { businessName: true, isOpen: true, supportsPickup: true, avgDeliveryMinutes: true } },
} as const;

function findListingRows(prisma: PrismaClient, where: Record<string, unknown>, take: number) {
  return prisma.product.findMany({
    // Only sellable products from approved vendors ever reach a public listing.
    where: { isActive: true, vendor: { status: "approved" }, ...where },
    include: LISTING_INCLUDE,
    orderBy: { name: "asc" },
    take,
  });
}

type ProductWithVendor = Awaited<ReturnType<typeof findListingRows>>[number];

export function toListing(p: ProductWithVendor): ProductListingDto {
  const { vendor, ...product } = p;
  return {
    ...product,
    vendorName: vendor.businessName,
    vendorIsOpen: vendor.isOpen,
    vendorSupportsPickup: vendor.supportsPickup,
    avgDeliveryMinutes: vendor.avgDeliveryMinutes,
  };
}

/** The deal's discount as a percentage, 0 when it isn't actually discounted. */
export function discountPercent(p: { priceMinor: number; compareAtPriceMinor: number | null }) {
  if (p.compareAtPriceMinor == null || p.compareAtPriceMinor <= p.priceMinor) return 0;
  return Math.round(((p.compareAtPriceMinor - p.priceMinor) / p.compareAtPriceMinor) * 100);
}

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
          // A vendor also matches if one of its own active products does —
          // otherwise a customer who knows what they want but not which
          // vendor stocks it has no way to find it via search at all.
          ...(query.q
            ? {
                OR: [
                  { businessName: { contains: query.q, mode: "insensitive" } },
                  { products: { some: { isActive: true, name: { contains: query.q, mode: "insensitive" } } } },
                ],
              }
            : {}),
        },
        include: { category: true },
        take: query.limit,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
        orderBy: { businessName: "asc" },
      });

      const nextCursor = vendors.length === query.limit ? vendors[vendors.length - 1]?.id : undefined;
      const summaries = await vendorRatingSummaries(prisma, vendors.map((v) => v.id));
      return {
        vendors: vendors.map((v) => withRatingSummary(omitFields(v, [...PUBLIC_VENDOR_OMIT]), summaries.get(v.id))),
        nextCursor,
      };
    },

    async getVendor(vendorId: string) {
      const vendor = await prisma.vendorProfile.findUnique({
        where: { id: vendorId },
        include: { category: true },
      });
      if (!vendor || vendor.status !== "approved") throw new VendorNotFoundError();
      const summaries = await vendorRatingSummaries(prisma, [vendorId]);
      return withRatingSummary(omitFields(vendor, [...PUBLIC_VENDOR_OMIT]), summaries.get(vendorId));
    },

    async getVendorProducts(vendorId: string) {
      return prisma.product.findMany({
        where: { vendorId, isActive: true },
        orderBy: { name: "asc" },
      });
    },

    /**
     * Home's "Deals near you" — products whose vendor has marked them down,
     * biggest discount first. Prisma can't compare two columns in a WHERE,
     * so the price check happens after the fetch; the over-fetch (3x) keeps a
     * mostly-undiscounted catalogue from starving the list.
     */
    async listDeals(limit: number): Promise<ProductListingDto[]> {
      const rows = await findListingRows(prisma, { compareAtPriceMinor: { not: null }, stock: { gt: 0 } }, limit * 3);
      return rows
        .filter((p) => discountPercent(p) > 0)
        .sort((a, b) => discountPercent(b) - discountPercent(a))
        .slice(0, limit)
        .map(toListing);
    },

    /**
     * One product's own page. `pairsWith` is the "Goes well with" row: other
     * in-stock products from the *same vendor* — a bag is single-vendor
     * (brief §3.1), so suggesting another shop's item would be a dead end.
     * Derived from the live catalogue, not curated, so it can't go stale.
     */
    async getProduct(productId: string): Promise<{ product: ProductListingDto; pairsWith: ProductListingDto[] }> {
      const [row] = await findListingRows(prisma, { id: productId }, 1);
      if (!row) throw new ProductNotFoundError();
      const siblings = await findListingRows(prisma, { vendorId: row.vendorId, id: { not: productId }, stock: { gt: 0 } }, 3);
      return { product: toListing(row), pairsWith: siblings.map(toListing) };
    },

    /** Product-level search — name or vendor name — with the Search screen's filters. */
    async searchProducts(query: ProductSearchQuery): Promise<ProductListingDto[]> {
      const where: Record<string, unknown> = {};
      if (query.q) {
        where.OR = [
          { name: { contains: query.q, mode: "insensitive" } },
          { vendor: { businessName: { contains: query.q, mode: "insensitive" } } },
        ];
      }
      if (query.maxPriceMinor) where.priceMinor = { lte: query.maxPriceMinor };
      if (query.onSale) where.compareAtPriceMinor = { not: null };
      if (query.openNow) where.vendor = { status: "approved", isOpen: true };
      const rows = await findListingRows(prisma, where, query.limit * (query.onSale ? 3 : 1));
      return rows
        .filter((p) => !query.onSale || discountPercent(p) > 0)
        .slice(0, query.limit)
        .map(toListing);
    },

    /**
     * US-C-10's other public half — the average/count already shown on
     * VendorDto is an aggregate; this is the individual reviews behind it.
     * No reviewer name in the response — CustomerProfile/User never
     * collects one (email/phone only) — the frontend labels every row
     * "Customer" rather than fabricating one.
     */
    async getVendorRatings(vendorId: string, limit: number) {
      return prisma.rating.findMany({
        where: { targetType: "vendor", targetId: vendorId },
        select: { id: true, score: true, comment: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: limit,
      });
    },

    /** How many 1–5 star ratings a vendor has — exact (a groupBy over every rating), not sampled from the newest page of reviews. */
    async getVendorRatingDistribution(vendorId: string): Promise<Record<1 | 2 | 3 | 4 | 5, number>> {
      const grouped = await prisma.rating.groupBy({
        by: ["score"],
        where: { targetType: "vendor", targetId: vendorId },
        _count: { score: true },
      });
      const out: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      for (const g of grouped) {
        if (g.score >= 1 && g.score <= 5) out[g.score as 1 | 2 | 3 | 4 | 5] = g._count.score;
      }
      return out;
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
      assertValidSalePrice(input.priceMinor, input.compareAtPriceMinor);

      return prisma.product.create({ data: { ...input, vendorId: vendor.id } });
    },

    /** US-V-03 — price edits never touch past OrderItem snapshots; that's structural (OrderItem copies name/priceMinor at purchase time), not enforced here. */
    async updateProduct(userId: string, productId: string, input: ProductUpdateInput) {
      const vendor = await prisma.vendorProfile.findUnique({ where: { userId } });
      if (!vendor) throw new VendorNotFoundError();

      const product = await prisma.product.findUnique({ where: { id: productId } });
      if (!product || product.vendorId !== vendor.id) throw new ProductNotFoundError();

      // Validate the price pair as it will be *after* this PATCH, so changing
      // only the price can't silently leave a stale, lower "was" price behind.
      assertValidSalePrice(
        input.priceMinor ?? product.priceMinor,
        input.compareAtPriceMinor !== undefined ? input.compareAtPriceMinor : product.compareAtPriceMinor,
      );

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
