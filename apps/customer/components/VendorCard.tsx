import Link from "next/link";
import type { VendorDto } from "@closebuy/types";

export function VendorCard({ vendor }: { vendor: VendorDto }) {
  const score = Number(vendor.reliabilityScore);

  return (
    <Link href={`/vendors/${vendor.id}`} className="block">
      <div className="flex gap-3 rounded-xl border border-gray-200 bg-white p-3 shadow-sm active:bg-surface">
        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-surface">
          {vendor.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- external, vendor-supplied URLs; no fixed domain set to allowlist for next/image
            <img src={vendor.logoUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <div className="flex h-full items-center justify-center text-lg font-semibold text-muted">
              {vendor.businessName.charAt(0).toUpperCase()}
            </div>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate font-semibold text-ink">{vendor.businessName}</p>
            {!vendor.isOpen && (
              <span className="shrink-0 rounded-full bg-muted/10 px-2 py-0.5 text-[10px] font-medium text-muted">Closed</span>
            )}
          </div>
          <p className="truncate text-xs text-muted">{vendor.category.name}</p>
          <div className="flex items-center gap-2 text-xs text-muted">
            <span>{score > 0 ? `★ ${score.toFixed(1)}` : "New"}</span>
            {vendor.avgDeliveryMinutes != null && <span>· {vendor.avgDeliveryMinutes} min</span>}
            {vendor.supportsPickup && <span>· Pickup available</span>}
          </div>
          <p className="truncate text-xs text-muted">{vendor.pickupLandmark}</p>
        </div>
      </div>
    </Link>
  );
}
