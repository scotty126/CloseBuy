"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Input, useAuthSession } from "@closebuy/ui";
import { ApiClientError } from "@closebuy/api-client";
import type { AdminConfigDto, CategoryDto } from "@closebuy/types";
import { adminApi } from "@/lib/api";

/** screens-navigation.md §4.4 — US-A-02. Categories, commission rates, Founding Vendor Program, delivery fee, accept-window. Every write is a new versioned Config row, never an edit (US-A-02's own acceptance criterion). */
export default function ConfigPage() {
  const router = useRouter();
  const { session, isLoaded } = useAuthSession();

  const [config, setConfig] = useState<AdminConfigDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Form fields, seeded from `config` once it loads.
  const [commissionRatePickup, setCommissionRatePickup] = useState("");
  const [commissionRateDelivery, setCommissionRateDelivery] = useState("");
  const [vendorAcceptWindowMinutes, setVendorAcceptWindowMinutes] = useState("");
  const [flatDeliveryFeeNaira, setFlatDeliveryFeeNaira] = useState("");
  const [riderCashFloatLimitNaira, setRiderCashFloatLimitNaira] = useState("");
  const [foundingVendorProgramActive, setFoundingVendorProgramActive] = useState(false);
  const [foundingVendorProgramWaiverMonths, setFoundingVendorProgramWaiverMonths] = useState("");

  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryPrepMinutes, setNewCategoryPrepMinutes] = useState("15");
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPrepMinutes, setEditPrepMinutes] = useState("");
  const [categoryActionId, setCategoryActionId] = useState<string | null>(null);

  useEffect(() => {
    if (isLoaded && !session) router.push("/login");
  }, [isLoaded, session, router]);

  function applyConfig(data: AdminConfigDto) {
    setConfig(data);
    setCommissionRatePickup(String(data.commissionRatePickup));
    setCommissionRateDelivery(String(data.commissionRateDelivery));
    setVendorAcceptWindowMinutes(String(data.vendorAcceptWindowMinutes));
    setFlatDeliveryFeeNaira((data.flatDeliveryFeeMinor / 100).toFixed(2));
    setRiderCashFloatLimitNaira((data.riderCashFloatLimitMinor / 100).toFixed(2));
    setFoundingVendorProgramActive(data.foundingVendorProgramActive);
    setFoundingVendorProgramWaiverMonths(String(data.foundingVendorProgramWaiverMonths));
  }

  useEffect(() => {
    if (!session) return;
    adminApi
      .getConfig()
      .then(applyConfig)
      .catch((err) => setLoadError(err instanceof ApiClientError ? err.message : "Couldn't load configuration."));
  }, [session]);

  if (!isLoaded || !session) return null;
  if (loadError) return <p className="text-sm text-danger">{loadError}</p>;
  if (!config) return <p className="text-sm text-muted">Loading…</p>;

  async function handleSaveConfig() {
    if (!config) return;
    const flatDeliveryFeeMinor = Math.round(parseFloat(flatDeliveryFeeNaira) * 100);
    const riderCashFloatLimitMinor = Math.round(parseFloat(riderCashFloatLimitNaira) * 100);
    const next = {
      commissionRatePickup: Number(commissionRatePickup),
      commissionRateDelivery: Number(commissionRateDelivery),
      vendorAcceptWindowMinutes: Number(vendorAcceptWindowMinutes),
      flatDeliveryFeeMinor,
      riderCashFloatLimitMinor,
      foundingVendorProgramActive,
      foundingVendorProgramWaiverMonths: Number(foundingVendorProgramWaiverMonths),
    };

    // Only send what actually changed — PATCH semantics, and avoids
    // writing a new Config version for a field nobody touched.
    const body: Record<string, unknown> = {};
    if (next.commissionRatePickup !== config.commissionRatePickup) body.commissionRatePickup = next.commissionRatePickup;
    if (next.commissionRateDelivery !== config.commissionRateDelivery) body.commissionRateDelivery = next.commissionRateDelivery;
    if (next.vendorAcceptWindowMinutes !== config.vendorAcceptWindowMinutes) body.vendorAcceptWindowMinutes = next.vendorAcceptWindowMinutes;
    if (next.flatDeliveryFeeMinor !== config.flatDeliveryFeeMinor) body.flatDeliveryFeeMinor = next.flatDeliveryFeeMinor;
    if (next.riderCashFloatLimitMinor !== config.riderCashFloatLimitMinor) body.riderCashFloatLimitMinor = next.riderCashFloatLimitMinor;
    if (next.foundingVendorProgramActive !== config.foundingVendorProgramActive) body.foundingVendorProgramActive = next.foundingVendorProgramActive;
    if (next.foundingVendorProgramWaiverMonths !== config.foundingVendorProgramWaiverMonths) body.foundingVendorProgramWaiverMonths = next.foundingVendorProgramWaiverMonths;

    if (Object.keys(body).length === 0) return;

    setIsSaving(true);
    setSaveError(null);
    try {
      const updated = await adminApi.updateConfig(body as any);
      applyConfig(updated);
    } catch (err) {
      setSaveError(err instanceof ApiClientError ? err.message : "That change didn't save.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCreateCategory() {
    if (!newCategoryName.trim()) return;
    setIsCreatingCategory(true);
    setCategoryError(null);
    try {
      const { category } = await adminApi.createCategory({
        name: newCategoryName.trim(),
        defaultPrepMinutes: Number(newCategoryPrepMinutes) || 15,
      });
      setConfig((prev) => (prev ? { ...prev, categories: [...prev.categories, category].sort((a, b) => a.name.localeCompare(b.name)) } : prev));
      setNewCategoryName("");
      setNewCategoryPrepMinutes("15");
    } catch (err) {
      setCategoryError(err instanceof ApiClientError ? err.message : "Couldn't create that category.");
    } finally {
      setIsCreatingCategory(false);
    }
  }

  function startEditCategory(category: CategoryDto) {
    setEditingCategoryId(category.id);
    setEditName(category.name);
    setEditPrepMinutes(String(category.defaultPrepMinutes));
    setCategoryError(null);
  }

  function replaceCategory(updated: CategoryDto) {
    setConfig((prev) => (prev ? { ...prev, categories: prev.categories.map((c) => (c.id === updated.id ? updated : c)) } : prev));
  }

  async function handleSaveCategoryEdit(category: CategoryDto) {
    setCategoryActionId(category.id);
    setCategoryError(null);
    try {
      const { category: updated } = await adminApi.updateCategory(category.id, {
        name: editName.trim(),
        defaultPrepMinutes: Number(editPrepMinutes) || category.defaultPrepMinutes,
      });
      replaceCategory(updated);
      setEditingCategoryId(null);
    } catch (err) {
      setCategoryError(err instanceof ApiClientError ? err.message : "Couldn't save that category.");
    } finally {
      setCategoryActionId(null);
    }
  }

  async function handleToggleActive(category: CategoryDto) {
    setCategoryActionId(category.id);
    setCategoryError(null);
    try {
      const { category: updated } = await adminApi.updateCategory(category.id, { isActive: !category.isActive });
      replaceCategory(updated);
    } catch (err) {
      setCategoryError(err instanceof ApiClientError ? err.message : "Couldn't change that category's status.");
    } finally {
      setCategoryActionId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold text-ink">Configuration</h1>
        <p className="text-sm text-muted">
          Every change here is a new versioned config row — it never rewrites history, and it never alters an order
          already placed (US-A-02).
        </p>
      </div>

      <Card className="flex flex-col gap-4">
        <p className="text-sm font-semibold text-ink">Commission & fees</p>
        {saveError && <p className="text-sm text-danger">{saveError}</p>}
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Pickup commission (%)"
            type="number"
            min="0"
            max="100"
            step="0.1"
            value={commissionRatePickup}
            onChange={(e) => setCommissionRatePickup(e.target.value)}
          />
          <Input
            label="Delivery commission (%)"
            type="number"
            min="0"
            max="100"
            step="0.1"
            value={commissionRateDelivery}
            onChange={(e) => setCommissionRateDelivery(e.target.value)}
          />
          <Input
            label="Flat delivery fee (₦)"
            type="number"
            min="0"
            step="0.01"
            value={flatDeliveryFeeNaira}
            onChange={(e) => setFlatDeliveryFeeNaira(e.target.value)}
          />
          <Input
            label="Rider cash limit (₦) — over this, cash-on-delivery jobs pause"
            type="number"
            min="0.01"
            step="0.01"
            value={riderCashFloatLimitNaira}
            onChange={(e) => setRiderCashFloatLimitNaira(e.target.value)}
          />
          <Input
            label="Vendor accept window (minutes)"
            type="number"
            min="1"
            step="1"
            value={vendorAcceptWindowMinutes}
            onChange={(e) => setVendorAcceptWindowMinutes(e.target.value)}
          />
        </div>

        <div className="border-t border-gray-200 pt-4">
          <p className="mb-2 text-sm font-semibold text-ink">Founding Vendor Program</p>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={foundingVendorProgramActive}
                onChange={(e) => setFoundingVendorProgramActive(e.target.checked)}
              />
              Open to new vendors
            </label>
            <div className="w-48">
              <Input
                label="Waiver duration (months)"
                type="number"
                min="1"
                step="1"
                value={foundingVendorProgramWaiverMonths}
                onChange={(e) => setFoundingVendorProgramWaiverMonths(e.target.value)}
              />
            </div>
          </div>
        </div>

        <Button type="button" disabled={isSaving} onClick={handleSaveConfig} className="self-start">
          {isSaving ? "Saving…" : "Save changes"}
        </Button>
      </Card>

      <Card className="flex flex-col gap-3">
        <p className="text-sm font-semibold text-ink">Categories</p>
        {categoryError && <p className="text-sm text-danger">{categoryError}</p>}

        <div className="flex flex-col divide-y divide-gray-100">
          {config.categories.map((category) => (
            <div key={category.id} className="flex items-center justify-between gap-3 py-2">
              {editingCategoryId === category.id ? (
                <div className="flex flex-1 items-end gap-2">
                  <Input label="Name" value={editName} onChange={(e) => setEditName(e.target.value)} />
                  <div className="w-32">
                    <Input
                      label="Prep (min)"
                      type="number"
                      min="1"
                      value={editPrepMinutes}
                      onChange={(e) => setEditPrepMinutes(e.target.value)}
                    />
                  </div>
                  <Button
                    type="button"
                    disabled={categoryActionId === category.id || !editName.trim()}
                    onClick={() => handleSaveCategoryEdit(category)}
                  >
                    Save
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => setEditingCategoryId(null)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <>
                  <div>
                    <p className={`text-sm ${category.isActive ? "text-ink" : "text-muted line-through"}`}>{category.name}</p>
                    <p className="text-xs text-muted">{category.defaultPrepMinutes} min prep{!category.isActive && " · inactive"}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" variant="secondary" onClick={() => startEditCategory(category)}>
                      Edit
                    </Button>
                    <Button
                      type="button"
                      variant={category.isActive ? "danger" : "secondary"}
                      disabled={categoryActionId === category.id}
                      onClick={() => handleToggleActive(category)}
                    >
                      {category.isActive ? "Deactivate" : "Reactivate"}
                    </Button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>

        <div className="flex items-end gap-2 border-t border-gray-200 pt-3">
          <div className="flex-1">
            <Input label="New category name" value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} />
          </div>
          <div className="w-32">
            <Input
              label="Prep (min)"
              type="number"
              min="1"
              value={newCategoryPrepMinutes}
              onChange={(e) => setNewCategoryPrepMinutes(e.target.value)}
            />
          </div>
          <Button type="button" disabled={isCreatingCategory || !newCategoryName.trim()} onClick={handleCreateCategory}>
            {isCreatingCategory ? "Adding…" : "Add category"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
