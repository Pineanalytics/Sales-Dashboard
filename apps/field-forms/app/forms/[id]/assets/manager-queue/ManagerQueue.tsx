"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { transitionAsset } from "@/lib/assetLifecycle";
import { notifyFormAdmins, notifyUser } from "@/lib/notify";
import type { Asset } from "@/lib/assetTypes";

export default function ManagerQueue({
  formId,
  assets,
  employeeNames,
}: {
  formId: string;
  assets: Asset[];
  employeeNames: Record<string, string>;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [comments, setComments] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function endorse(asset: Asset) {
    const { data } = await supabase.auth.getUser();
    if (!data.user) return;
    setBusyId(asset.id);
    setError(null);
    const { error: err } = await transitionAsset(supabase, {
      assetId: asset.id,
      from: "Pending Manager Review",
      to: "Pending Admin Verification",
      actorId: data.user.id,
      comment: comments[asset.id] || "Endorsed by line manager.",
    });
    setBusyId(null);
    if (err) setError(err);
    else {
      await notifyFormAdmins(supabase, formId, "manager_endorsed", `Manager endorsed an asset submission — ready for verification.`, asset.id);
      router.refresh();
    }
  }

  async function returnForCorrection(asset: Asset) {
    const comment = comments[asset.id];
    if (!comment?.trim()) {
      setError("Please add a comment explaining what needs to change.");
      return;
    }
    const { data } = await supabase.auth.getUser();
    if (!data.user) return;
    setBusyId(asset.id);
    setError(null);
    const { error: err } = await transitionAsset(supabase, {
      assetId: asset.id,
      from: "Pending Manager Review",
      to: "Returned for Correction",
      actorId: data.user.id,
      comment,
    });
    setBusyId(null);
    if (err) setError(err);
    else {
      if (asset.current_employee_id) {
        await notifyUser(supabase, asset.current_employee_id, "returned_for_correction", `Your manager returned an asset submission for correction: ${comment}`, asset.id);
      }
      router.refresh();
    }
  }

  if (assets.length === 0) {
    return (
      <div className="border border-dashed border-[var(--line)] rounded-lg p-10 text-center text-[var(--ink-600)]">
        Nothing awaiting your review.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <p className="text-sm text-[var(--rust-600)]" role="alert">
          {error}
        </p>
      )}
      {assets.map((asset) => {
        const busy = busyId === asset.id;
        return (
          <div key={asset.id} className="bg-white border border-[var(--line)] rounded-lg p-5">
            <div className="flex items-start justify-between gap-4 mb-3">
              <div>
                <h2 className="font-display text-lg text-[var(--ink-900)]">
                  {asset.description || asset.asset_number || "Untitled asset"}
                </h2>
                <p className="text-sm text-[var(--ink-600)]">
                  {employeeNames[asset.current_employee_id ?? ""] ?? "Unknown employee"} ·{" "}
                  {asset.condition ?? "Condition not set"}
                </p>
              </div>
            </div>
            <textarea
              value={comments[asset.id] ?? ""}
              onChange={(e) =>
                setComments((prev) => ({ ...prev, [asset.id]: e.target.value }))
              }
              placeholder="Add a comment (required if returning for correction)"
              rows={2}
              className="w-full rounded-md border border-[var(--line)] px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-[var(--pine-500)]"
            />
            <div className="flex gap-3">
              <button
                disabled={busy}
                onClick={() => endorse(asset)}
                className="rounded-md bg-[var(--pine-700)] text-white text-sm font-medium px-4 py-2 hover:bg-[var(--pine-900)] disabled:opacity-60"
              >
                Endorse
              </button>
              <button
                disabled={busy}
                onClick={() => returnForCorrection(asset)}
                className="rounded-md border border-[var(--line)] text-sm font-medium px-4 py-2 text-[var(--rust-600)] hover:border-[var(--rust-600)] disabled:opacity-60"
              >
                Return for correction
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
