"use client";

import { useState } from "react";

export function ReviewDecision({ accompanimentId, existingComments }: { accompanimentId: string; existingComments: string | null }) {
  const [comments, setComments] = useState(existingComments ?? "");
  const [saving, setSaving] = useState<"supervisor_reviewed" | "approved" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function save(status: "supervisor_reviewed" | "approved") {
    setSaving(status);
    setMessage(null);
    try {
      const response = await fetch("/api/coaching/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accompanimentId, status, comments }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not save this decision.");
      setMessage(status === "approved" ? "Approved. The shared Coaching record is now up to date." : "Feedback saved to the shared Coaching record.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save this decision.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="mt-2 flex flex-col gap-2">
      <textarea
        aria-label="Supervisor feedback"
        value={comments}
        onChange={(event) => setComments(event.target.value)}
        placeholder="Add clear feedback for the Team Leader…"
        className="min-h-16 w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs text-foreground outline-none transition focus:border-primary-blue focus:ring-2 focus:ring-primary-blue/15"
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => save("supervisor_reviewed")}
          disabled={saving !== null}
          className="rounded-full border border-primary-blue/30 px-3 py-1.5 text-xs font-semibold text-primary-blue hover:bg-accent-blue-soft disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving === "supervisor_reviewed" ? "Saving…" : "Save feedback"}
        </button>
        <button
          type="button"
          onClick={() => save("approved")}
          disabled={saving !== null}
          className="rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-3 py-1.5 text-xs font-semibold text-white shadow-cyan-glow disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving === "approved" ? "Approving…" : "Approve"}
        </button>
      </div>
      {message ? <p className="text-xs text-muted">{message}</p> : null}
    </div>
  );
}
