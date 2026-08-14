"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { AssetCategory, AssetFieldRule } from "@/lib/assetTypes";

const FIELD_KEYS: { key: string; label: string }[] = [
  { key: "serial_number", label: "Serial number" },
  { key: "imei", label: "IMEI" },
  { key: "sim_number", label: "SIM number" },
  { key: "vehicle_reg", label: "Vehicle registration" },
  { key: "chassis_vin", label: "Chassis / VIN" },
  { key: "engine_number", label: "Engine number" },
];

export default function CategoriesManager({
  formId,
  initialCategories,
  initialFieldRules,
}: {
  formId: string;
  initialCategories: AssetCategory[];
  initialFieldRules: AssetFieldRule[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newTopName, setNewTopName] = useState("");
  const [newSubName, setNewSubName] = useState<Record<string, string>>({});

  const topLevel = initialCategories
    .filter((c) => !c.parent_id)
    .sort((a, b) => a.order_index - b.order_index);
  const subsOf = (parentId: string) =>
    initialCategories
      .filter((c) => c.parent_id === parentId)
      .sort((a, b) => a.order_index - b.order_index);
  const rulesOf = (categoryId: string) =>
    initialFieldRules.filter((r) => r.category_id === categoryId);

  async function refresh() {
    router.refresh();
  }

  async function addCategory(name: string, parentId: string | null, orderIndex: number) {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.from("asset_categories").insert({
      form_id: formId,
      name: name.trim(),
      parent_id: parentId,
      order_index: orderIndex,
    });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    setNewTopName("");
    setNewSubName({});
    refresh();
  }

  async function toggleActive(category: AssetCategory) {
    setBusy(true);
    const { error: err } = await supabase
      .from("asset_categories")
      .update({ is_active: !category.is_active })
      .eq("id", category.id);
    setBusy(false);
    if (err) setError(err.message);
    else refresh();
  }

  async function rename(category: AssetCategory, name: string) {
    if (!name.trim() || name === category.name) return;
    const { error: err } = await supabase
      .from("asset_categories")
      .update({ name: name.trim() })
      .eq("id", category.id);
    if (err) setError(err.message);
    else refresh();
  }

  async function move(category: AssetCategory, direction: -1 | 1) {
    const siblings = category.parent_id
      ? subsOf(category.parent_id)
      : topLevel;
    const idx = siblings.findIndex((c) => c.id === category.id);
    const swapWith = siblings[idx + direction];
    if (!swapWith) return;
    setBusy(true);
    await Promise.all([
      supabase
        .from("asset_categories")
        .update({ order_index: swapWith.order_index })
        .eq("id", category.id),
      supabase
        .from("asset_categories")
        .update({ order_index: category.order_index })
        .eq("id", swapWith.id),
    ]);
    setBusy(false);
    refresh();
  }

  async function toggleManagerReview(category: AssetCategory) {
    setBusy(true);
    const { error: err } = await supabase
      .from("asset_categories")
      .update({ requires_manager_review: !category.requires_manager_review })
      .eq("id", category.id);
    setBusy(false);
    if (err) setError(err.message);
    else refresh();
  }

  // A rule row existing at all means the field is shown for this category;
  // is_required additionally makes it mandatory. Unchecking "Show" removes
  // the row entirely (a field can't be required if it isn't shown).
  async function toggleShown(categoryId: string, fieldKey: string, currentlyShown: boolean) {
    setBusy(true);
    if (currentlyShown) {
      const rule = rulesOf(categoryId).find((r) => r.field_key === fieldKey);
      if (rule) await supabase.from("asset_field_rules").delete().eq("id", rule.id);
    } else {
      await supabase
        .from("asset_field_rules")
        .insert({ category_id: categoryId, field_key: fieldKey, is_required: false });
    }
    setBusy(false);
    refresh();
  }

  async function toggleRequired(categoryId: string, fieldKey: string, currentlyRequired: boolean) {
    setBusy(true);
    const rule = rulesOf(categoryId).find((r) => r.field_key === fieldKey);
    if (rule) {
      await supabase
        .from("asset_field_rules")
        .update({ is_required: !currentlyRequired })
        .eq("id", rule.id);
    } else {
      await supabase
        .from("asset_field_rules")
        .insert({ category_id: categoryId, field_key: fieldKey, is_required: true });
    }
    setBusy(false);
    refresh();
  }

  return (
    <div>
      {error && (
        <p className="mb-4 text-sm text-[var(--rust-600)]" role="alert">
          {error}
        </p>
      )}

      <div className="flex gap-2 mb-6">
        <input
          type="text"
          value={newTopName}
          onChange={(e) => setNewTopName(e.target.value)}
          placeholder="New top-level category name"
          className="flex-1 rounded-md border border-[var(--line)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--pine-500)]"
        />
        <button
          disabled={busy}
          onClick={() => addCategory(newTopName, null, topLevel.length)}
          className="rounded-md bg-[var(--pine-700)] text-white text-sm font-medium px-4 py-2 hover:bg-[var(--pine-900)] disabled:opacity-50"
        >
          + Add category
        </button>
      </div>

      <div className="space-y-3">
        {topLevel.map((cat) => (
          <div
            key={cat.id}
            className="bg-white border border-[var(--line)] rounded-lg p-4"
          >
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setExpanded(expanded === cat.id ? null : cat.id)}
                className="text-[var(--ink-400)] w-5"
              >
                {expanded === cat.id ? "▾" : "▸"}
              </button>
              <input
                type="text"
                defaultValue={cat.name}
                onBlur={(e) => rename(cat, e.target.value)}
                className={`flex-1 font-display text-base rounded-md border border-transparent hover:border-[var(--line)] px-2 py-1 ${
                  !cat.is_active ? "opacity-50 line-through" : ""
                }`}
              />
              <div className="flex items-center gap-2 text-xs">
                <button onClick={() => move(cat, -1)} className="text-[var(--ink-400)] hover:text-[var(--pine-700)]">↑</button>
                <button onClick={() => move(cat, 1)} className="text-[var(--ink-400)] hover:text-[var(--pine-700)]">↓</button>
                <button
                  onClick={() => toggleActive(cat)}
                  className="text-[var(--ink-600)] hover:text-[var(--pine-700)] hover:underline"
                >
                  {cat.is_active ? "Deactivate" : "Activate"}
                </button>
              </div>
            </div>

            {expanded === cat.id && (
              <div className="mt-4 ml-8 space-y-3">
                {subsOf(cat.id).map((sub) => (
                  <div
                    key={sub.id}
                    className="border border-[var(--line)] rounded-md p-3 bg-[var(--sand-50)]"
                  >
                    <div className="flex items-center gap-3 mb-2">
                      <input
                        type="text"
                        defaultValue={sub.name}
                        onBlur={(e) => rename(sub, e.target.value)}
                        className={`flex-1 text-sm font-medium rounded-md border border-transparent hover:border-[var(--line)] px-2 py-1 ${
                          !sub.is_active ? "opacity-50 line-through" : ""
                        }`}
                      />
                      <div className="flex items-center gap-2 text-xs">
                        <button onClick={() => move(sub, -1)} className="text-[var(--ink-400)] hover:text-[var(--pine-700)]">↑</button>
                        <button onClick={() => move(sub, 1)} className="text-[var(--ink-400)] hover:text-[var(--pine-700)]">↓</button>
                        <button
                          onClick={() => toggleActive(sub)}
                          className="text-[var(--ink-600)] hover:text-[var(--pine-700)] hover:underline"
                        >
                          {sub.is_active ? "Deactivate" : "Activate"}
                        </button>
                      </div>
                    </div>
                    <label className="flex items-center gap-1.5 text-xs text-[var(--ink-600)] mb-2">
                      <input
                        type="checkbox"
                        checked={sub.requires_manager_review}
                        onChange={() => toggleManagerReview(sub)}
                        className="accent-[var(--pine-600)]"
                      />
                      Requires line-manager review before admin verification
                    </label>
                    <div className="flex flex-wrap gap-4">
                      {FIELD_KEYS.map((f) => {
                        const rule = rulesOf(sub.id).find((r) => r.field_key === f.key);
                        const shown = !!rule;
                        const required = !!rule?.is_required;
                        return (
                          <div key={f.key} className="flex items-center gap-3 text-xs text-[var(--ink-600)]">
                            <span className="font-medium text-[var(--ink-900)]">{f.label}</span>
                            <label className="flex items-center gap-1.5">
                              <input
                                type="checkbox"
                                checked={shown}
                                onChange={() => toggleShown(sub.id, f.key, shown)}
                                className="accent-[var(--pine-600)]"
                              />
                              Show
                            </label>
                            <label className="flex items-center gap-1.5">
                              <input
                                type="checkbox"
                                checked={required}
                                disabled={!shown}
                                onChange={() => toggleRequired(sub.id, f.key, required)}
                                className="accent-[var(--pine-600)]"
                              />
                              Require
                            </label>
                          </div>
                        );
                      })}
                    </div>
                    <p className="mt-2 text-xs text-[var(--ink-400)]">
                      Barcode and QR-code value are always shown — every asset gets a Pinefrost tag.
                    </p>
                  </div>
                ))}

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newSubName[cat.id] ?? ""}
                    onChange={(e) =>
                      setNewSubName((prev) => ({ ...prev, [cat.id]: e.target.value }))
                    }
                    placeholder="New subcategory name"
                    className="flex-1 rounded-md border border-[var(--line)] px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--pine-500)]"
                  />
                  <button
                    disabled={busy}
                    onClick={() =>
                      addCategory(
                        newSubName[cat.id] ?? "",
                        cat.id,
                        subsOf(cat.id).length
                      )
                    }
                    className="rounded-md border border-[var(--line)] text-sm font-medium px-3 py-1.5 hover:border-[var(--pine-500)] disabled:opacity-50"
                  >
                    + Add subcategory
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
