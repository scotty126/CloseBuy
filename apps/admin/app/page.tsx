"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, Placeholder, useAuthSession } from "@closebuy/ui";

export default function ApplicationsPage() {
  const router = useRouter();
  const { session, isLoaded } = useAuthSession();

  useEffect(() => {
    if (isLoaded && !session) router.push("/login");
  }, [isLoaded, session, router]);

  if (!isLoaded || !session) return null;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <p className="text-sm text-muted">Signed in as</p>
        <p className="text-lg font-semibold text-ink">{session.user.phone}</p>
      </Card>
      <Placeholder
        title="Vendor & rider applications"
        note="Vetting queue, founding-vendor waiver applied on approval — screens-navigation.md §4.1, US-A-01. Built in M1."
      />
    </div>
  );
}
