"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, Placeholder, useAuthSession } from "@closebuy/ui";

export default function HomePage() {
  const router = useRouter();
  const { session, isLoaded } = useAuthSession();

  useEffect(() => {
    if (isLoaded && !session) router.push("/login");
  }, [isLoaded, session, router]);

  if (!isLoaded || !session) return null;

  return (
    <div className="flex flex-col gap-4 p-4">
      <Card>
        <p className="text-sm text-muted">Signed in as</p>
        <p className="text-lg font-semibold text-ink">{session.user.phone}</p>
      </Card>
      <Placeholder
        title="Duty toggle & job offers"
        note="On-duty toggle, offer card, active job — screens-navigation.md §3.1/3.2, US-R-02/03/04/05. Built in M1."
      />
    </div>
  );
}
