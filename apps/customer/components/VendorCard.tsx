import Link from "next/link";
import { Star, Clock, MapPin } from "lucide-react";
import type { VendorDto } from "@closebuy/types";

/**
 * Vertical, image-forward card — DoorDash's "Saved Stores"/search-result
 * card shape (reference kit), not the old horizontal thumbnail row. Cover
 * is the business name as text for now (product decision — no vendor
 * photos yet), same treatment as the storefront hero (vendors/[id]/page.tsx)
 * so a card and its own detail page never look like two different vendors.
 */
export function VendorCard({ vendor }: { vendor: VendorDto }) {
  return (
    <Link
      href={`/vendors/${vendor.id}`}
      className="block overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm active:bg-surface"
    >
      <div className="flex h-24 w-full items-center justify-center bg-primary/10 px-4">
        {vendor.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- external, vendor-supplied URL
          <img src={vendor.logoUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <p className="truncate text-center text-base font-bold text-primary">{vendor.businessName}</p>
        )}
      </div>

      <div className="flex flex-col gap-1 p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate font-semibold text-ink">{vendor.businessName}</p>
          {!vendor.isOpen && (
            <span className="shrink-0 rounded-full bg-muted/10 px-2 py-0.5 text-[10px] font-medium text-muted">Closed</span>
          )}
        </div>
        <p className="truncate text-xs text-muted">{vendor.category.name}</p>

        <div className="flex items-center gap-3 text-xs text-muted">
          <span className="flex items-center gap-1">
            <Star size={13} className={vendor.ratingAverage != null ? "fill-accent text-accent" : ""} />
            {vendor.ratingAverage != null ? `${vendor.ratingAverage.toFixed(1)} (${vendor.ratingCount})` : "New"}
          </span>
          {vendor.avgDeliveryMinutes != null && (
            <span className="flex items-center gap-1">
              <Clock size={13} />
              {vendor.avgDeliveryMinutes} min
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 text-xs text-muted">
          <MapPin size={13} className="shrink-0" />
          <span className="truncate">{vendor.pickupLandmark}</span>
          {vendor.supportsPickup && <span className="shrink-0">· Pickup available</span>}
        </div>
      </div>
    </Link>
  );
}
