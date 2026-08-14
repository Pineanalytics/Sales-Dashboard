import type { SupabaseClient } from "@supabase/supabase-js";
import { REASON_REQUIRED_EVENTS, type AssetStatus } from "./assetTypes";

// The lifecycle from spec §3, flattened into an explicit transition table so
// the UI only ever offers valid next actions and the DB check constraint on
// `assets.status` stays in sync with what the app can actually produce.
export const ASSET_TRANSITIONS: Record<AssetStatus, AssetStatus[]> = {
  Draft: ["Submitted"],
  Submitted: ["Pending Manager Review", "Pending Admin Verification"],
  "Pending Manager Review": ["Pending Admin Verification", "Returned for Correction"],
  "Pending Admin Verification": ["Verified", "Rejected", "Returned for Correction"],
  "Returned for Correction": ["Submitted"],
  Verified: ["Active"],
  Rejected: ["Draft"],
  Active: ["Transferred", "Returned", "Under Repair", "Lost", "Stolen", "Retired", "Disposed"],
  Transferred: ["Active"],
  Returned: ["Active", "Retired", "Disposed"],
  "Under Repair": ["Active", "Retired", "Disposed"],
  Lost: ["Retired", "Disposed"],
  Stolen: ["Retired", "Disposed"],
  Retired: ["Disposed"],
  Disposed: [],
};

export function canTransition(from: AssetStatus, to: AssetStatus): boolean {
  return ASSET_TRANSITIONS[from]?.includes(to) ?? false;
}

// event_type used for asset_events — a slug derived from the status change,
// since that's what the comment-required check constraint keys off.
export function eventTypeForTransition(to: AssetStatus): string {
  const map: Partial<Record<AssetStatus, string>> = {
    Submitted: "submitted",
    "Pending Manager Review": "manager_review_requested",
    "Pending Admin Verification": "admin_verification_requested",
    "Returned for Correction": "returned_for_correction",
    Verified: "verified",
    Rejected: "rejected",
    Active: "allocated",
    Transferred: "transferred",
    Returned: "returned",
    "Under Repair": "condition_changed",
    Lost: "lost",
    Stolen: "stolen",
    Retired: "retired",
    Disposed: "disposed",
  };
  return map[to] ?? to.toLowerCase().replace(/\s+/g, "_");
}

export function isReasonRequired(eventType: string): boolean {
  return REASON_REQUIRED_EVENTS.has(eventType);
}

// Applies a status transition: updates the asset row and appends the
// permanent audit-trail event in one call, so callers can't do one without
// the other. Not wrapped in a DB transaction (this codebase has no server
// action layer yet — every other multi-step write follows the same
// sequential-calls pattern under RLS), so a mid-way failure is surfaced to
// the caller to retry rather than silently left half-applied.
export async function transitionAsset(
  supabase: SupabaseClient,
  params: {
    assetId: string;
    from: AssetStatus;
    to: AssetStatus;
    actorId: string;
    comment?: string | null;
    extraAssetFields?: Record<string, unknown>;
  }
): Promise<{ error: string | null }> {
  const { assetId, from, to, actorId, comment, extraAssetFields } = params;

  if (!canTransition(from, to)) {
    return { error: `Cannot move an asset from "${from}" to "${to}".` };
  }
  const eventType = eventTypeForTransition(to);
  if (isReasonRequired(eventType) && !comment?.trim()) {
    return { error: "A reason/comment is required for this action." };
  }

  const { error: updErr } = await supabase
    .from("assets")
    .update({ status: to, updated_at: new Date().toISOString(), ...extraAssetFields })
    .eq("id", assetId);
  if (updErr) return { error: updErr.message };

  const { error: evErr } = await supabase.from("asset_events").insert({
    asset_id: assetId,
    event_type: eventType,
    actor_id: actorId,
    from_value: { status: from },
    to_value: { status: to, ...extraAssetFields },
    comment: comment || null,
  });
  if (evErr) return { error: evErr.message };

  return { error: null };
}
