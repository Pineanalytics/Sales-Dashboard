import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { auth, signIn } from "@/auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (session?.user) {
    redirect("/");
  }

  const { error } = await searchParams;

  async function login(formData: FormData) {
    "use server";
    try {
      await signIn("credentials", {
        email: formData.get("email"),
        password: formData.get("password"),
        redirectTo: "/",
      });
    } catch (err) {
      if (err instanceof AuthError) {
        redirect("/login?error=CredentialsSignin");
      }
      throw err;
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-dark-navy to-primary-blue px-4">
      <div className="w-full max-w-sm rounded-2xl bg-surface p-8 shadow-[0_8px_24px_rgba(0,0,0,0.20)]">
        <h1 className="text-2xl font-bold text-primary-blue">Sales Performance Dashboard</h1>
        <p className="mt-1 text-sm text-muted">Sign in to view or manage sales reports.</p>

        <form action={login} className="mt-6 flex flex-col gap-4">
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
              className="rounded-full border border-border bg-surface px-4 py-2 text-sm text-foreground outline-none transition-colors focus:border-secondary-blue"
              placeholder="you@company.com"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="password" className="text-[13px] font-medium text-muted-strong">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="rounded-full border border-border bg-surface px-4 py-2 text-sm text-foreground outline-none transition-colors focus:border-secondary-blue"
              placeholder="••••••••"
            />
          </div>

          {error ? (
            <p className="rounded-xl border-l-4 border-l-accent-red bg-surface px-3 py-2 text-xs text-accent-red shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
              Invalid email or password.
            </p>
          ) : null}

          <button
            type="submit"
            className="mt-2 rounded-full bg-button-blue px-4 py-3 text-sm font-semibold text-white transition-colors duration-300 hover:bg-button-blue-hover"
          >
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
}
