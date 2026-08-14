"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { notifyUser } from "@/lib/notify";
import type { CoachingAccompaniment } from "@/lib/coachingTypes";

export default function ReviewActions({
  formId,
  accompaniment,
}: {
  formId: string;
  accompaniment: CoachingAccompaniment;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [comment, setComment] = useState(accompaniment.supervisor_comments ?? "");
  const [busy, setBusy] = useState(false);

  const alreadyDecided = accompaniment.status === "approved";

  async function decide(approve: boolean) {
    if (!comment.trim()) {
      window.alert("Add a supervisor comment so the Team Leader receives clear feedback and the decision is auditable.");
      return;
    }
    setBusy(true);
    await supabase
      .from("coaching_accompaniments")
      .update({
        status: approve ? "approved" : "draft",
        supervisor_comments: comment || null,
      })
      .eq("id", accompaniment.id);
    await notifyUser(
      supabase,
      accompaniment.team_leader_id,
      approve ? "coaching_approved" : "coaching_correction_requested",
      approve
        ? `Your accompaniment from ${accompaniment.date} was approved. Feedback: ${comment}`
        : `Your accompaniment from ${accompaniment.date} needs correction. Feedback: ${comment}`
    );
    setBusy(false);
    router.push(`/forms/${formId}/coaching/review`);
    router.refresh();
  }

  if (alreadyDecided) {
    return (
      <div className="bg-[var(--pine-100)] text-[var(--pine-700)] rounded-md px-4 py-3 text-sm">
        Approved. {accompaniment.supervisor_comments && `Comment: ${accompaniment.supervisor_comments}`}
      </div>
    );
  }

  return (
    <div className="bg-white border border-[var(--line)] rounded-lg p-4 space-y-3">
      <label className="block text-xs font-mono-label uppercase tracking-wide text-[var(--ink-600)]">
        Required supervisor feedback
      </label>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={2}
        className="w-full rounded-md border border-[var(--line)] px-3 py-2 text-sm"
      />
      <div className="flex gap-2">
        <button
          disabled={busy}
          onClick={() => decide(true)}
          className="flex-1 rounded-md bg-[var(--pine-700)] text-white text-sm font-medium py-2 hover:bg-[var(--pine-900)] disabled:opacity-50"
        >
          Approve
        </button>
        <button
          disabled={busy}
          onClick={() => decide(false)}
          className="flex-1 rounded-md border border-[var(--rust-600)] text-[var(--rust-600)] text-sm font-medium py-2 hover:bg-[var(--rust-600)]/10 disabled:opacity-50"
        >
          Request correction
        </button>
      </div>
    </div>
  );
}
