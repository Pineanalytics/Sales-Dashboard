import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_BRAND, type Brand } from "@/lib/brand";
import SignOutButton from "./SignOutButton";
import NotificationBell from "./NotificationBell";

export default async function Header() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let role: string | null = null;
  let status: string | null = null;
  let assignedFormId: string | null = null;
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, status, assigned_form_id")
      .eq("id", user.id)
      .single();
    role = profile?.role ?? null;
    status = profile?.status ?? null;
    assignedFormId = profile?.assigned_form_id ?? null;
  }
  const approved = status === "approved";
  const isManager = role === "admin" || role === "super_admin";

  let brand: Brand = DEFAULT_BRAND;
  if (assignedFormId) {
    const { data: form } = await supabase
      .from("forms")
      .select("brand_name, brand_logo_url")
      .eq("id", assignedFormId)
      .single();
    if (form?.brand_name) {
      brand = { name: form.brand_name, logoUrl: form.brand_logo_url };
    }
  }

  let pendingCount = 0;
  if (role === "admin" && assignedFormId) {
    const { count } = await supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending")
      .eq("assigned_form_id", assignedFormId);
    pendingCount = count ?? 0;
  } else if (role === "super_admin") {
    const { count } = await supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending");
    pendingCount = count ?? 0;
  }

  return (
    <header className="border-b border-[var(--line)] bg-white">
      <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          {brand.logoUrl && (
            <img
              src={brand.logoUrl}
              alt={brand.name}
              className="h-8 w-8 object-contain"
            />
          )}
          <span className="font-display text-base text-[var(--ink-900)]">
            {brand.name}
          </span>
        </Link>
        {user && (
          <nav className="flex items-center gap-5 text-sm">
            {approved ? (
              <>
                <Link
                  href="/"
                  className="text-[var(--ink-600)] hover:text-[var(--pine-700)]"
                >
                  Forms
                </Link>
                {isManager && (
                  <>
                    <Link
                      href="/admin"
                      className="text-[var(--ink-600)] hover:text-[var(--pine-700)]"
                    >
                      Admin
                    </Link>
                    <Link
                      href="/admin/users"
                      className="text-[var(--ink-600)] hover:text-[var(--pine-700)] inline-flex items-center gap-1.5"
                    >
                      Users
                      {pendingCount > 0 && (
                        <span className="inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-[var(--rust-600)] text-white text-[10px] font-medium">
                          {pendingCount}
                        </span>
                      )}
                    </Link>
                  </>
                )}
                {role === "super_admin" && (
                  <span className="text-[10px] font-mono-label uppercase tracking-wide text-white bg-[var(--pine-700)] rounded-full px-2 py-0.5">
                    Super admin
                  </span>
                )}
              </>
            ) : (
              <span className="text-xs font-mono-label uppercase tracking-wide text-[var(--rust-600)]">
                Pending approval
              </span>
            )}
            <span className="text-[var(--ink-400)] text-xs hidden sm:inline">
              {user.email}
            </span>
            {approved && <NotificationBell userId={user.id} />}
            <SignOutButton />
          </nav>
        )}
      </div>
    </header>
  );
}
