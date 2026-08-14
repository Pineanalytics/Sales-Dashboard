"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { DEFAULT_BRAND } from "@/lib/brand";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setLoading(true);

    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      setLoading(false);
      if (error) {
        setError(error.message);
        return;
      }
      router.push("/");
      router.refresh();
    } else {
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName } },
      });
      setLoading(false);
      if (signUpError || !signUpData.user) {
        setError(signUpError?.message ?? "Could not create account.");
        return;
      }

      setNotice(
        "Account created. An admin needs to approve you and assign you to a form before you can sign in."
      );
      setMode("signin");
    }
  }

  return (
    <main className="flex-1 flex items-center justify-center px-6 py-16 bg-[var(--sand-50)]">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          {DEFAULT_BRAND.logoUrl && (
            <img
              src={DEFAULT_BRAND.logoUrl}
              alt={DEFAULT_BRAND.name}
              className="mx-auto mb-4 h-16 w-16 object-contain"
            />
          )}
          <h1 className="font-display text-2xl text-[var(--ink-900)]">
            {DEFAULT_BRAND.name}
          </h1>
          <p className="mt-1 text-sm text-[var(--ink-600)]">
            {mode === "signin"
              ? "Sign in to fill out or manage forms"
              : "Create an account to get started"}
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-white border border-[var(--line)] rounded-lg p-6 space-y-4"
        >
          {mode === "signup" && (
            <div>
              <label className="block text-xs font-mono-label uppercase tracking-wide text-[var(--ink-600)] mb-1">
                Full name
              </label>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full rounded-md border border-[var(--line)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--pine-500)]"
              />
            </div>
          )}
          <div>
            <label className="block text-xs font-mono-label uppercase tracking-wide text-[var(--ink-600)] mb-1">
              Email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-[var(--line)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--pine-500)]"
            />
          </div>
          <div>
            <label className="block text-xs font-mono-label uppercase tracking-wide text-[var(--ink-600)] mb-1">
              Password
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

          {mode === "signup" && (
            <p className="text-xs text-[var(--ink-400)]">
              You&apos;ll be assigned to a form by an admin after your account is approved.
            </p>
          )}

          {error && (
            <p className="text-sm text-[var(--rust-600)]" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="text-sm text-[var(--pine-700)]" role="status">
              {notice}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-[var(--pine-700)] text-white text-sm font-medium py-2.5 hover:bg-[var(--pine-900)] transition-colors disabled:opacity-60"
          >
            {loading
              ? "Please wait…"
              : mode === "signin"
              ? "Sign in"
              : "Create account"}
          </button>
        </form>

        <button
          type="button"
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setError(null);
            setNotice(null);
          }}
          className="mt-4 w-full text-center text-sm text-[var(--ink-600)] hover:text-[var(--pine-700)]"
        >
          {mode === "signin"
            ? "Need an account? Sign up"
            : "Already have an account? Sign in"}
        </button>
      </div>
    </main>
  );
}
