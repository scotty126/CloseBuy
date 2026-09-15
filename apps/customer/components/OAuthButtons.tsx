import { googleSignInUrl, appleSignInUrl } from "@/lib/api";

// Plain <a> tags, not client-side navigation — these are full-page
// redirects to the API, which redirects on to the provider (brief §3.1b).
export function OAuthButtons() {
  return (
    <div className="flex flex-col gap-2">
      <a
        href={googleSignInUrl}
        className="flex items-center justify-center gap-2 rounded-lg border border-gray-300 py-2.5 text-sm font-medium text-ink hover:bg-surface"
      >
        Continue with Google
      </a>
      <a
        href={appleSignInUrl}
        className="flex items-center justify-center gap-2 rounded-lg border border-gray-300 py-2.5 text-sm font-medium text-ink hover:bg-surface"
      >
        Continue with Apple
      </a>
    </div>
  );
}
