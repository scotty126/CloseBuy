"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuthSession } from "@closebuy/ui";
import type { RiderProfileDto } from "@closebuy/types";
import { useRiderProfile } from "@/lib/useRiderProfile";
import { RiderApplicationForm } from "./RiderApplicationForm";

/** Mirrors the vendor app's VendorGate — see that file for the full reasoning. */
export function RiderGate({ children }: { children: (rider: RiderProfileDto, refetch: () => void) => ReactNode }) {
  const router = useRouter();
  const { session, isLoaded: sessionLoaded } = useAuthSession();
  const { rider, notFound, isLoaded: riderLoaded, error, refetch } = useRiderProfile(Boolean(session));

  useEffect(() => {
    if (sessionLoaded && !session) router.push("/login");
  }, [sessionLoaded, session, router]);

  if (!sessionLoaded || !session) return null;
  if (!riderLoaded) return <p className="p-6 text-sm text-muted">Loading…</p>;
  if (error) return <p className="p-6 text-sm text-danger">{error}</p>;
  if (notFound) return <RiderApplicationForm onSubmitted={refetch} />;
  if (!rider) return null;

  if (rider.status === "pending") {
    return (
      <StatusCard
        title="Application submitted"
        body="We're reviewing your application. You'll be able to go on duty as soon as it's approved (US-A-01)."
      />
    );
  }
  if (rider.status === "rejected") {
    return <StatusCard tone="danger" title="Application not approved" body="Reach out to CloseBuy support for details." />;
  }
  if (rider.status === "suspended") {
    return <StatusCard tone="danger" title="Account suspended" body="Reach out to CloseBuy support for details." />;
  }

  return <>{children(rider, refetch)}</>;
}

function StatusCard({ title, body, tone = "default" }: { title: string; body: string; tone?: "default" | "danger" }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-2 p-6 text-center">
      <p className={`text-lg font-semibold ${tone === "danger" ? "text-danger" : "text-ink"}`}>{title}</p>
      <p className="max-w-sm text-sm text-muted">{body}</p>
    </div>
  );
}
