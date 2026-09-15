"use client";

import Link from "next/link";
import { Card, Placeholder, useAuthSession } from "@closebuy/ui";

// No auth gate here — browsing never requires an account (brief §3.1b).
// The only place identity comes up at all is checkout, and even then it's
// optional (brief §3.1b, US-C-06).
export default function HomePage() {
  const { session, isLoaded } = useAuthSession();

  return (
    <div className="flex flex-col gap-4 p-4">
      <Card>
        {isLoaded && session ? (
          <>
            <p className="text-sm text-muted">Signed in as</p>
            <p className="text-lg font-semibold text-ink">{session.user.email}</p>
          </>
        ) : (
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted">Browsing as a guest</p>
            <Link href="/login" className="text-sm font-medium text-primary underline">
              Sign in
            </Link>
          </div>
        )}
      </Card>
      <Placeholder
        title="Home feed"
        note="Address bar, search, category chips and the vendor card feed — screens-navigation.md §1.1. Built in M1."
      />
    </div>
  );
}
