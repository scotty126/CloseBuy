"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuthSession } from "@closebuy/ui";
import { authApi } from "@/lib/api";

// Landing point for the Google/Apple redirect — the API hands off tokens
// via a URL fragment (never a query param or response body, since this is
// a full-page browser redirect, not an API call the client made directly)
// and this page turns that into a real session.
function OAuthCompleteInner() {
  const router = useRouter();
  const { save } = useAuthSession();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const accessToken = params.get("accessToken");
    const refreshToken = params.get("refreshToken");

    if (!accessToken || !refreshToken) {
      setError("Sign-in link was incomplete.");
      return;
    }

    // Save first so the api client's getAccessToken() has a token to send
    // on the .me() call below — corrected immediately after with the real
    // user object.
    save({
      accessToken,
      refreshToken,
      user: { id: "", role: "rider", email: null, emailVerifiedAt: null, phone: null, phoneVerifiedAt: null },
    });

    authApi
      .me()
      .then(({ user }) => {
        save({ accessToken, refreshToken, user });
        router.replace("/");
      })
      .catch(() => setError("Couldn't complete sign-in. Try again."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm text-danger">{error}</p>
        <Link href="/login" className="text-sm font-medium text-primary underline">
          Back to sign in
        </Link>
      </div>
    );
  }

  return <div className="flex min-h-screen items-center justify-center text-sm text-muted">Signing you in…</div>;
}

export default function OAuthCompletePage() {
  return (
    <Suspense fallback={null}>
      <OAuthCompleteInner />
    </Suspense>
  );
}
