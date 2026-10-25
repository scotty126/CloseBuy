import Link from "next/link";
import { ChevronRight, Store } from "lucide-react";
import type { VendorDto } from "@closebuy/types";
import { CATEGORY_ICONS } from "@/components/CategoryChips";
import { tileFor } from "@/components/DealCard";

/** One shop line on Home, to the canvas's measurements: a 40px tile (photo, else the category icon), name, one mono meta line. */
export function VendorRow({ vendor }: { vendor: VendorDto }) {
  const rating = vendor.ratingAverage != null ? `★ ${vendor.ratingAverage.toFixed(1)}` : "New";
  const Icon = CATEGORY_ICONS[vendor.category.name] ?? Store;
  return (
    <Link
      href={`/vendors/${vendor.id}`}
      className="flex items-center gap-3 border-b border-line px-3 py-2.5 text-ink transition-colors hover:bg-raised active:bg-raised lg:rounded-[14px] lg:border-0 lg:bg-card lg:shadow-[0_0_0_1px_rgb(var(--c-line))]"
    >
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[10px] text-[#0E1F19] ${tileFor(vendor.id)}`}>
        {vendor.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- external, vendor-supplied URL
          <img src={vendor.logoUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <Icon size={20} strokeWidth={1.6} aria-hidden="true" />
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-medium">{vendor.businessName}</span>
        <span className="truncate font-mono text-[11px] text-muted">
          {vendor.category.name}
          {vendor.avgDeliveryMinutes != null && ` · ${vendor.avgDeliveryMinutes} min`} · {rating}
        </span>
      </span>
      {vendor.supportsPickup && (
        <span className="rounded-md px-[7px] py-[3px] font-mono text-[10px] text-sale shadow-[inset_0_0_0_1px_#FF5A19]">PICKUP</span>
      )}
      <ChevronRight size={14} strokeWidth={2} className="shrink-0 text-muted" aria-hidden="true" />
    </Link>
  );
}
