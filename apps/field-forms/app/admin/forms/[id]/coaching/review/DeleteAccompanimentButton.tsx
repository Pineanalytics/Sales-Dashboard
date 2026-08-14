"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Super-admin-only cleanup for draft or badly-filled accompaniment records —
// RLS's own DELETE policy (is_super_admin()) is the real gate here; this
// button is only rendered for super admins to begin with (see review/page.tsx),
// so a non-super-admin never even sees it. Children (outlet visits, visit
// answers, action plans, self-evaluations, photos) all cascade automatically
// via ON DELETE CASCADE.
export default function DeleteAccompanimentButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm("Delete this accompaniment permanently? This also removes its outlet visits, answers, action plans, and self-evaluations. This cannot be undone.")) {
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("coaching_accompaniments").delete().eq("id", id);
    setBusy(false);
    if (error) {
      alert(`Could not delete: ${error.message}`);
      return;
    }
    router.refresh();
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={handleDelete}
      className="text-xs text-[var(--rust-600)] hover:underline disabled:opacity-50"
    >
      {busy ? "Deleting..." : "Delete"}
    </button>
  );
}
