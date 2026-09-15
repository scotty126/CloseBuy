"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button, Card, Input, Placeholder, useAuthSession } from "@closebuy/ui";
import { ApiClientError } from "@closebuy/api-client";
import { customerAuthApi } from "@/lib/api";

/**
 * screens-navigation.md §1.9. Real for what has backend support:
 * profile (email, default contact phone) and the orders shortcut. Saved
 * addresses, payment methods and ratings-given aren't built yet — there's
 * no Address CRUD or ratings-read endpoint to show real data against, so
 * they stay a Placeholder rather than a fake list.
 */
export default function AccountPage() {
  const router = useRouter();
  const { session, isLoaded, clear } = useAuthSession();

  const [defaultPhone, setDefaultPhone] = useState("");
  const [savedPhone, setSavedPhone] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!session) return;
    customerAuthApi
      .getProfile()
      .then((res) => {
        setDefaultPhone(res.profile.defaultPhone ?? "");
        setSavedPhone(res.profile.defaultPhone);
      })
      .catch(() => {});
  }, [session]);

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

  async function handleSavePhone() {
    setSaveError(null);
    setSaved(false);
    setIsSaving(true);
    try {
      const res = await customerAuthApi.updateProfile({ defaultPhone: defaultPhone.trim() || null });
      setSavedPhone(res.profile.defaultPhone);
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof ApiClientError ? err.message : "Couldn't save.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <Card>
        <p className="text-sm text-muted">Signed in as</p>
        <p className="text-lg font-semibold text-ink">{session.user.email}</p>
      </Card>

      <Link href="/orders" className="flex items-center justify-between rounded-xl border border-gray-200 bg-white p-4">
        <span className="text-sm font-medium text-ink">Order history</span>
        <span className="text-muted">›</span>
      </Link>

      <div className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-4">
        <p className="text-sm font-medium text-ink">Default contact number</p>
        <p className="text-xs text-muted">Presets the phone field at checkout — never verified, never used to sign in (brief §3.1b).</p>
        <Input
          type="tel"
          value={defaultPhone}
          onChange={(e) => {
            setDefaultPhone(e.target.value);
            setSaved(false);
          }}
          placeholder="+2348012345678"
        />
        {saveError && <p className="text-xs text-danger">{saveError}</p>}
        <Button
          variant="secondary"
          onClick={handleSavePhone}
          disabled={isSaving || defaultPhone === (savedPhone ?? "")}
        >
          {isSaving ? "Saving…" : saved ? "Saved" : "Save"}
        </Button>
      </div>

      <Placeholder title="Addresses & ratings" note="Saved addresses (US-C-05) and ratings given (US-C-10) — no backend endpoint yet for either. Real future scope, not a silent gap." />

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
