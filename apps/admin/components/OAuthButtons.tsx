import { googleSignInUrl, appleSignInUrl } from "@/lib/api";

// Plain <a> tags, not client-side navigation — these are full-page
// redirects to the API, which redirects on to the provider.
export function OAuthButtons() {
  return (
    <div className="flex flex-col gap-2">
      <a
        href={googleSignInUrl}
        className="flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white py-2.5 text-sm font-medium text-ink shadow-sm transition-all duration-150 ease-out hover:border-gray-300 hover:bg-surface active:scale-[0.98]"
      >
        Continue with Google
      </a>
      <a
        href={appleSignInUrl}
        className="flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white py-2.5 text-sm font-medium text-ink shadow-sm transition-all duration-150 ease-out hover:border-gray-300 hover:bg-surface active:scale-[0.98]"
      >
        Continue with Apple
      </a>
    </div>
  );
}
