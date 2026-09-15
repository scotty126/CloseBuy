"use client";

import { useRouter } from "next/navigation";
import { Button, Placeholder, useAuthSession } from "@closebuy/ui";

export default function AccountPage() {
  const router = useRouter();
  const { session, isLoaded, clear } = useAuthSession();

  if (!isLoaded) return null;

  // A guest reaches order status via their tracking link (US-C-06a), not
  // through here — this screen is specifically for a signed-in account.
  if (!session) {
    return (
      <div className="flex flex-col items-center gap-4 p-4 text-center">
        <Placeholder
          title="No account yet"
          note="Sign in for order history, saved addresses and editable ratings — none of it required just to order."
        />
        <Button onClick={() => router.push("/login")}>Sign in</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <Placeholder title="Account" note="screens-navigation.md §1.9 — addresses, payment methods, ratings given. Built in M1/M3." />
      <Button
        variant="secondary"
        onClick={() => {
          clear();
          router.push("/");
        }}
      >
        Sign out
      </Button>
    </div>
  );
}
