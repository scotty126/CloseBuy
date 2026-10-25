"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

/** Sticky bar shared by the Terms and Privacy pages: back, a two-tab switch between the documents, and the theme toggle. */
export function LegalHeader({ active }: { active: "terms" | "privacy" }) {
  const router = useRouter();
  return (
    <header className="sticky top-0 z-10 flex items-center gap-1.5 border-b border-line bg-surface/90 p-2 backdrop-blur-md">
      <button
        type="button"
        onClick={() => (window.history.length > 1 ? router.back() : router.push("/account"))}
        aria-label="Back"
        className="flex h-11 w-11 items-center justify-center text-ink"
      >
        <ArrowLeft size={18} strokeWidth={2} />
      </button>
      <div role="tablist" className="grid flex-1 grid-cols-2 rounded-[10px] p-[3px] shadow-[inset_0_0_0_1px_rgb(var(--c-line))]">
        {(["terms", "privacy"] as const).map((t) => (
          <Link
            key={t}
            href={`/${t}`}
            role="tab"
            aria-selected={active === t}
            className={`flex h-[38px] items-center justify-center rounded-lg text-[13px] transition-colors ${active === t ? "bg-raised font-semibold" : "font-normal"} text-ink`}
          >
            {t === "terms" ? "Terms" : "Privacy"}
          </Link>
        ))}
      </div>
      <span className="w-11" aria-hidden="true" />
    </header>
  );
}
