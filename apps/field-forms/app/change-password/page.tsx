"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function ChangePasswordPage() {
  const router = useRouter();
  const supabase = createClient();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }

    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setLoading(false);
      setError(updateError.message);
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      await supabase.from("profiles").update({ must_change_password: false }).eq("id", user.id);
    }

    setLoading(false);
    router.push("/");
    router.refresh();
  }

  return (
    <main className="flex-1 flex items-center justify-center px-6 py-16 bg-[var(--sand-50)]">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="font-display text-2xl text-[var(--ink-900)]">Set a new password</h1>
          <p className="mt-1 text-sm text-[var(--ink-600)]">
            You&apos;re signed in with a temporary shared password. Set your own password to
            continue.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-white border border-[var(--line)] rounded-lg p-6 space-y-4"
        >
          <div>
            <label className="block text-xs font-mono-label uppercase tracking-wide text-[var(--ink-600)] mb-1">
              New password
            </label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-[var(--line)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--pine-500)]"
            />
          </div>
          <div>
            <label className="block text-xs font-mono-label uppercase tracking-wide text-[var(--ink-600)] mb-1">
              Confirm new password
            </label>
            <input
              type="password"
              required
              minLength={6}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full rounded-md border border-[var(--line)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--pine-500)]"
            />
          </div>

          {error && (
            <p className="text-sm text-[var(--rust-600)]" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-[var(--pine-700)] text-white text-sm font-medium py-2.5 hover:bg-[var(--pine-900)] transition-colors disabled:opacity-60"
          >
            {loading ? "Saving…" : "Save and continue"}
          </button>
        </form>
      </div>
    </main>
  );
}
