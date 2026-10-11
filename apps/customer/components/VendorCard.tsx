import Link from "next/link";
import { Star, Clock, MapPin } from "lucide-react";
import type { VendorDto } from "@closebuy/types";

/**
 * Vertical, image-forward card — DoorDash's "Saved Stores"/search-result
 * card shape (reference kit), not the old horizontal thumbnail row. Cover
 * is the real storefront photo when `logoUrl` is set (2026-09-30 —
 * apps/api/public/storefronts/, real photos of real vendors), falling
 * back to the business name as text for the vendors that don't have one
 * yet — same treatment as the storefront hero (vendors/[id]/page.tsx) so
 * a card and its own detail page never look like two different vendors.
 * Badges (status, category) are real pills over the cover — same idea as
 * Foodys' reference screens, CloseBuy's own green/orange, never their red.
 */
export function VendorCard({ vendor }: { vendor: VendorDto }) {
  return (
    <Link
      href={`/vendors/${vendor.id}`}
      className="group block overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_20px_-12px_rgba(0,0,0,0.1)] transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.04),0_16px_32px_-12px_rgba(0,0,0,0.16)] active:scale-[0.99] active:bg-surface"
    >
      <div className="relative flex h-32 w-full items-center justify-center overflow-hidden bg-primary/10 px-4">
        {vendor.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- external, vendor-supplied URL
          <img
            src={vendor.logoUrl}
            alt=""
            className="h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-105"
          />
        ) : (
          <p className="truncate text-center text-lg font-extrabold text-primary">{vendor.businessName}</p>
        )}

        <span className="absolute left-2 top-2 rounded-full bg-black/55 px-2.5 py-1 text-[10px] font-semibold text-white backdrop-blur-sm">
          {vendor.category.name}
        </span>
        <span
          className={`absolute right-2 top-2 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide shadow-sm ${
            vendor.isOpen ? "bg-success text-white" : "bg-white text-muted"
          }`}
        >
          {vendor.isOpen ? "Open" : "Closed"}
        </span>
      </div>

      <div className="flex flex-col gap-1.5 p-3.5">
        <p className="truncate text-base font-bold text-ink">{vendor.businessName}</p>

        <div className="flex items-center gap-3 text-xs font-medium text-muted">
          <span className="flex items-center gap-1">
            <Star size={14} className={vendor.ratingAverage != null ? "fill-accent text-accent" : "text-muted"} />
            <span className={vendor.ratingAverage != null ? "text-ink" : ""}>
              {vendor.ratingAverage != null ? `${vendor.ratingAverage.toFixed(1)} (${vendor.ratingCount})` : "New"}
            </span>
          </span>
          {vendor.avgDeliveryMinutes != null && (
            <span className="flex items-center gap-1">
              <Clock size={14} />
              {vendor.avgDeliveryMinutes} min
            </span>
          )}
          {vendor.supportsPickup && <span className="rounded-md bg-surface px-1.5 py-0.5 text-[10px] font-semibold text-ink">Pickup</span>}
        </div>

        <div className="flex items-center gap-1 text-xs text-muted">
          <MapPin size={13} className="shrink-0" />
          <span className="truncate">{vendor.pickupLandmark}</span>
        </div>
      </div>
    </Link>
  );
}
