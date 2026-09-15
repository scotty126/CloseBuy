"use client";

import { useRouter } from "next/navigation";
import { Button, Placeholder, useAuthSession } from "@closebuy/ui";

export default function AccountPage() {
  const router = useRouter();
  const { clear } = useAuthSession();

  return (
    <div className="flex flex-col gap-4 p-4">
      <Placeholder title="Account" note="screens-navigation.md §1.9 — addresses, payment methods, ratings given. Built in M1/M3." />
      <Button
        variant="secondary"
        onClick={() => {
          clear();
          router.push("/login");
        }}
      >
        Sign out
      </Button>
    </div>
  );
}
