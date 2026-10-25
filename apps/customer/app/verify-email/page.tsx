"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AuthShell } from "@closebuy/ui";
import { customerAuthApi } from "@/lib/api";

// Never blocks anything (US-C-01) — this page just confirms the click
// happened; the account has worked fine since signup regardless.
function VerifyEmailInner() {
  const token = useSearchParams().get("token") ?? "";
  const [status, setStatus] = useState<"checking" | "verified" | "invalid">("checking");

  useEffect(() => {
    if (!token) {
      setStatus("invalid");
      return;
    }
    customerAuthApi
      .verifyEmail(token)
      .then(({ verified }) => setStatus(verified ? "verified" : "invalid"))
      .catch(() => setStatus("invalid"));
  }, [token]);

  return (
    <AuthShell
      app="customer"
      route="verify-email"
      title={status === "verified" ? "Email verified" : status === "invalid" ? "Link not valid" : "Verifying your email…"}
      subtitle={
        status === "invalid"
          ? "This link is invalid or expired — your account still works fine either way."
          : status === "verified"
            ? "You're all set."
            : "Just a moment."
      }
    >
      <Link href="/" className="flex h-[46px] items-center justify-center rounded-[11px] bg-accent text-sm font-semibold text-night">
        Back to CloseBuy
      </Link>
    </AuthShell>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailInner />
    </Suspense>
  );
}
