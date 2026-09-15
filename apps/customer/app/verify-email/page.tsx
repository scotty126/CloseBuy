"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
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
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
      {status === "checking" && <p className="text-sm text-muted">Verifying…</p>}
      {status === "verified" && <p className="text-sm text-success">Email verified.</p>}
      {status === "invalid" && (
        <p className="text-sm text-muted">This link is invalid or expired — your account still works fine either way.</p>
      )}
      <Link href="/" className="text-sm font-medium text-primary underline">
        Back to CloseBuy
      </Link>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailInner />
    </Suspense>
  );
}
