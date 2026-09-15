"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuthSession } from "@closebuy/ui";
import type { OwnVendorProfileDto } from "@closebuy/types";
import { useVendorProfile } from "@/lib/useVendorProfile";
import { VendorApplicationForm } from "./VendorApplicationForm";

/**
 * Wraps every "real" vendor screen. A signed-in phone/OTP account (M0)
 * doesn't automatically have a VendorProfile — US-V-01 is a separate
 * application step, reviewed by an operator (US-A-01) — so every one of
 * these screens needs the same branch: no profile yet → application
 * form; pending/rejected/suspended → a status card, not the real
 * dashboard; approved → the actual screen. Centralized here once rather
 * than repeated in Orders/Products/Settings/Earnings.
 */
export function VendorGate({ children }: { children: (vendor: OwnVendorProfileDto, refetch: () => void) => ReactNode }) {
  const router = useRouter();
  const { session, isLoaded: sessionLoaded } = useAuthSession();
  const { vendor, notFound, isLoaded: vendorLoaded, error, refetch } = useVendorProfile(Boolean(session));

  useEffect(() => {
    if (sessionLoaded && !session) router.push("/login");
  }, [sessionLoaded, session, router]);

  if (!sessionLoaded || !session) return null;
  if (!vendorLoaded) return <p className="p-6 text-sm text-muted">Loading…</p>;
  if (error) return <p className="p-6 text-sm text-danger">{error}</p>;
  if (notFound) return <VendorApplicationForm onSubmitted={refetch} />;
  if (!vendor) return null;

  if (vendor.status === "pending") {
    return (
      <StatusCard
        title="Application submitted"
        body="We're reviewing your application. You'll be able to start selling as soon as it's approved — usually quick, since an operator has to look at it themselves (US-A-01)."
      />
    );
  }
  if (vendor.status === "rejected") {
    return (
      <StatusCard
        tone="danger"
        title="Application not approved"
        body="Your application wasn't approved this time. Reach out to CloseBuy support for details."
      />
    );
  }
  if (vendor.status === "suspended") {
    return (
      <StatusCard
        tone="danger"
        title="Account suspended"
        body="Your vendor account has been suspended. Reach out to CloseBuy support for details."
      />
    );
  }

  return <>{children(vendor, refetch)}</>;
}

function StatusCard({ title, body, tone = "default" }: { title: string; body: string; tone?: "default" | "danger" }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-2 p-6 text-center">
      <p className={`text-lg font-semibold ${tone === "danger" ? "text-danger" : "text-ink"}`}>{title}</p>
      <p className="max-w-sm text-sm text-muted">{body}</p>
    </div>
  );
}
