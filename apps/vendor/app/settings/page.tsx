"use client";

import { useState } from "react";
import { Button, Input } from "@closebuy/ui";
import { ApiClientError } from "@closebuy/api-client";
import type { OwnVendorProfileDto } from "@closebuy/types";
import { catalogApi } from "@/lib/api";
import { VendorGate } from "@/components/VendorGate";

const DAYS = [
  { key: "mon", label: "Monday" },
  { key: "tue", label: "Tuesday" },
  { key: "wed", label: "Wednesday" },
  { key: "thu", label: "Thursday" },
  { key: "fri", label: "Friday" },
  { key: "sat", label: "Saturday" },
  { key: "sun", label: "Sunday" },
];

/** screens-navigation.md §2.3 — US-V-02. `isOpen` and `supportsPickup` are independent toggles, not derived from each other. */
export default function SettingsPage() {
  return <VendorGate>{(vendor, refetch) => <StoreSettings vendor={vendor} refetch={refetch} />}</VendorGate>;
}

function StoreSettings({ vendor, refetch }: { vendor: OwnVendorProfileDto; refetch: () => void }) {
  const [businessName, setBusinessName] = useState(vendor.businessName);
  const [description, setDescription] = useState(vendor.description ?? "");
  const [logoUrl, setLogoUrl] = useState(vendor.logoUrl ?? "");
  const [isOpen, setIsOpen] = useState(vendor.isOpen);
  const [supportsPickup, setSupportsPickup] = useState(vendor.supportsPickup);
  const [hours, setHours] = useState<Record<string, [string, string] | null>>(() => {
    const initial: Record<string, [string, string] | null> = {};
    for (const d of DAYS) initial[d.key] = vendor.openingHours?.[d.key] ?? null;
    return initial;
  });
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setIsSaving(true);
    try {
      const openingHours: Record<string, [string, string]> = {};
      for (const [day, range] of Object.entries(hours)) if (range) openingHours[day] = range;

      await catalogApi.updateOwnVendor({
        businessName,
        description: description || undefined,
        logoUrl: logoUrl || undefined,
        isOpen,
        supportsPickup,
        openingHours,
      });
      refetch();
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Couldn't save your settings.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-lg font-bold text-ink">Store settings</h1>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input label="Business name" value={businessName} onChange={(e) => { setBusinessName(e.target.value); setSaved(false); }} required />
        <Input label="Description" value={description} onChange={(e) => { setDescription(e.target.value); setSaved(false); }} />
        <Input label="Logo URL" value={logoUrl} onChange={(e) => { setLogoUrl(e.target.value); setSaved(false); }} placeholder="https://…" />

        <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white p-3">
          <div>
            <p className="text-sm font-medium text-ink">Open for orders</p>
            <p className="text-xs text-muted">Toggle off any time you can&apos;t take new orders.</p>
          </div>
          <ToggleSwitch checked={isOpen} onChange={(v) => { setIsOpen(v); setSaved(false); }} />
        </div>

        <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white p-3">
          <div>
            <p className="text-sm font-medium text-ink">Offer pickup</p>
            <p className="text-xs text-muted">Customers can collect in person instead of ordering delivery — independent of the toggle above.</p>
          </div>
          <ToggleSwitch checked={supportsPickup} onChange={(v) => { setSupportsPickup(v); setSaved(false); }} />
        </div>

        <div className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-3">
          <p className="text-sm font-medium text-ink">Opening hours</p>
          {DAYS.map((day) => (
            <div key={day.key} className="flex items-center gap-2">
              <span className="w-24 shrink-0 text-sm text-ink">{day.label}</span>
              {hours[day.key] ? (
                <>
                  <input
                    type="time"
                    value={hours[day.key]![0]}
                    onChange={(e) => {
                      setHours((h) => ({ ...h, [day.key]: [e.target.value, h[day.key]![1]] }));
                      setSaved(false);
                    }}
                    className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                  />
                  <span className="text-muted">–</span>
                  <input
                    type="time"
                    value={hours[day.key]![1]}
                    onChange={(e) => {
                      setHours((h) => ({ ...h, [day.key]: [h[day.key]![0], e.target.value] }));
                      setSaved(false);
                    }}
                    className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => { setHours((h) => ({ ...h, [day.key]: null })); setSaved(false); }}
                    className="text-xs text-muted underline"
                  >
                    Closed
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => { setHours((h) => ({ ...h, [day.key]: ["09:00", "18:00"] })); setSaved(false); }}
                  className="text-xs text-primary underline"
                >
                  Set hours
                </button>
              )}
            </div>
          ))}
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}

        <Button type="submit" disabled={isSaving}>
          {isSaving ? "Saving…" : saved ? "Saved" : "Save changes"}
        </Button>
      </form>
    </div>
  );
}

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition ${checked ? "bg-primary" : "bg-gray-300"}`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${checked ? "left-5" : "left-0.5"}`} />
    </button>
  );
}
