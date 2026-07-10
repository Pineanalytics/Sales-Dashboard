import Link from "next/link";
import { redirect } from "next/navigation";
import Image from "next/image";
import { auth } from "@/auth";
import { registerAction } from "./actions";

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const session = await auth();
  if (session?.user) {
    redirect("/");
  }

  const { error, success } = await searchParams;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-dark-navy to-primary-blue px-4">
      <div className="w-full max-w-sm rounded-2xl bg-surface p-8 shadow-[0_8px_24px_rgba(0,0,0,0.20)]">
        <Image src="/pinefrost-logo.png" alt="Pinefrost Limited" width={1014} height={810} className="h-20 w-auto rounded-lg object-contain" />
        <h1 className="mt-3 text-2xl font-bold text-primary-blue">Request Dashboard Access</h1>
        <p className="mt-1 text-sm text-muted">Submit your details and an administrator will review your request.</p>

        {success ? (
          <div className="mt-6 flex flex-col gap-4">
            <p className="rounded-xl border-l-4 border-l-accent-green bg-surface px-4 py-3 text-sm text-accent-green shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
              Your request has been submitted and is awaiting admin approval. You'll be able to sign in once it's approved.
            </p>
            <Link
              href="/login"
              className="text-center text-sm font-semibold text-primary-blue hover:underline"
            >
              Back to sign in
            </Link>
          </div>
        ) : (
          <form action={registerAction} className="mt-6 flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <label htmlFor="name" className="text-[13px] font-medium text-muted-strong">
                Name
              </label>
              <input
                id="name"
                name="name"
                type="text"
                autoComplete="name"
                className="rounded-full border border-border bg-surface px-4 py-2 text-sm text-foreground outline-none transition-colors focus:border-secondary-blue"
                placeholder="Jane Doe"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="email" className="text-[13px] font-medium text-muted-strong">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoFocus
                autoComplete="email"
                pattern=".+@pinefrost\.co\.ke"
                title="Must be a @pinefrost.co.ke email address"
                className="rounded-full border border-border bg-surface px-4 py-2 text-sm text-foreground outline-none transition-colors focus:border-secondary-blue"
                placeholder="you@pinefrost.co.ke"
              />
              <span className="text-[11px] text-muted">Must be a @pinefrost.co.ke address.</span>
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="password" className="text-[13px] font-medium text-muted-strong">
                Password (min 8 characters)
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                className="rounded-full border border-border bg-surface px-4 py-2 text-sm text-foreground outline-none transition-colors focus:border-secondary-blue"
                placeholder="••••••••"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="confirmPassword" className="text-[13px] font-medium text-muted-strong">
                Confirm password
              </label>
              <input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                className="rounded-full border border-border bg-surface px-4 py-2 text-sm text-foreground outline-none transition-colors focus:border-secondary-blue"
                placeholder="••••••••"
              />
            </div>

            {error ? (
              <p className="rounded-xl border-l-4 border-l-accent-red bg-surface px-3 py-2 text-xs text-accent-red shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              className="mt-2 rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-4 py-3 text-sm font-semibold text-white transition-all duration-300 hover:shadow-cyan-glow"
            >
              Request access
            </button>

            <Link href="/login" className="text-center text-sm font-semibold text-primary-blue hover:underline">
              Back to sign in
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}
