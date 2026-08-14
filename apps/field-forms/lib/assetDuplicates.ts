import type { SupabaseClient } from "@supabase/supabase-js";
import { DUPLICATE_CHECK_FIELDS } from "./assetTypes";

export interface DuplicateMatch {
  field: string;
  value: string;
  matchedAssetId: string;
  matchedAssetNumber: string | null;
  matchedStatus: string;
}

// Checks the identification fields that must be unique in practice
// (asset number, serial, IMEI, vehicle reg, barcode, QR) against existing
// assets for this tenant, excluding the asset being edited. Never merges —
// callers surface matches for a human to review.
export async function findDuplicateAssets(
  supabase: SupabaseClient,
  formId: string,
  values: Partial<Record<(typeof DUPLICATE_CHECK_FIELDS)[number], string>>,
  excludeAssetId?: string
): Promise<DuplicateMatch[]> {
  const matches: DuplicateMatch[] = [];

  for (const field of DUPLICATE_CHECK_FIELDS) {
    const value = values[field]?.trim();
    if (!value) continue;

    let query = supabase
      .from("assets")
      .select("id, asset_number, status")
      .eq("form_id", formId)
      .ilike(field, value);
    if (excludeAssetId) query = query.neq("id", excludeAssetId);

    const { data } = await query;
    for (const row of data ?? []) {
      matches.push({
        field,
        value,
        matchedAssetId: row.id,
        matchedAssetNumber: row.asset_number,
        matchedStatus: row.status,
      });
    }
  }

  return matches;
}

// Cleans up a serial/IMEI/barcode-style value: trim, collapse whitespace,
// uppercase (identification codes are conventionally case-insensitive).
export function normalizeIdValue(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toUpperCase();
}

export function isValidImei(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  return digits.length === 15;
}
