"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuthSession, AuthShell } from "@closebuy/ui";
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
      user: { id: "", role: "admin", email: null, emailVerifiedAt: null, phone: null, phoneVerifiedAt: null },
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
      <AuthShell app="admin" route="oauth-complete" title="Couldn't sign you in" subtitle={error}>
        <Link href="/login" className="flex h-[46px] items-center justify-center rounded-[11px] bg-accent text-sm font-semibold text-night">
          Back to sign in
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell app="admin" route="oauth-complete" title="Signing you in…" subtitle="Finishing Google sign-in. This only takes a moment.">
      <div className="flex justify-center py-4" role="status" aria-label="Signing in">
        <span className="h-9 w-9 animate-spin rounded-full border-4 border-line border-t-accent" />
      </div>
    </AuthShell>
  );
}

export default function OAuthCompletePage() {
  return (
    <Suspense fallback={null}>
      <OAuthCompleteInner />
    </Suspense>
  );
}
