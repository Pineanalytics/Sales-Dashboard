import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function AdminHome() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, assigned_form_id")
    .eq("id", user!.id)
    .single();

  const isSuperAdmin = profile?.role === "super_admin";

  // A form admin can be allocated more than one form by the super admin
  // (see admin_form_access) — scope their listing to that set instead of
  // the old single assigned_form_id.
  let query = supabase
    .from("forms")
    .select("id, title, is_active, brand_name, system_type, created_at, submissions(count)")
    .order("created_at", { ascending: false });
  if (!isSuperAdmin) {
    const { data: allocations } = await supabase
      .from("admin_form_access")
      .select("form_id")
      .eq("admin_id", user!.id);
    const allocatedFormIds = (allocations ?? []).map((a) => a.form_id);
    query = query.in("id", allocatedFormIds.length > 0 ? allocatedFormIds : ["00000000-0000-0000-0000-000000000000"]);
  }
  const { data: forms } = await query;

  return (
    <main className="flex-1 bg-[var(--sand-50)]">
      <div className="max-w-4xl mx-auto px-6 py-12">
        <div className="flex items-start justify-between mb-8">
          <div>
            <p className="font-mono-label text-xs uppercase tracking-wider text-[var(--pine-600)] mb-2">
              Admin
            </p>
            <h1 className="font-display text-3xl text-[var(--ink-900)]">
              Forms
            </h1>
          </div>
          {isSuperAdmin && (
            <Link
              href="/admin/forms/new"
              className="rounded-md bg-[var(--pine-700)] text-white text-sm font-medium px-4 py-2.5 hover:bg-[var(--pine-900)] transition-colors"
            >
              + New form
            </Link>
          )}
        </div>

        {(!forms || forms.length === 0) && (
          <div className="border border-dashed border-[var(--line)] rounded-lg p-10 text-center text-[var(--ink-600)]">
            {isSuperAdmin
              ? "No forms yet. Create your first one."
              : "No form assigned to you yet."}
          </div>
        )}

        <ul className="space-y-3">
          {forms?.map((form: any) => (
            <li
              key={form.id}
              className="bg-white border border-[var(--line)] rounded-lg px-5 py-4 flex items-center justify-between"
            >
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-display text-lg text-[var(--ink-900)]">
                    {form.title}
                  </h2>
                  <span
                    className={`text-xs font-mono-label uppercase tracking-wide rounded-full px-2 py-0.5 ${
                      form.is_active
                        ? "bg-[var(--pine-100)] text-[var(--pine-700)]"
                        : "bg-[var(--sand-100)] text-[var(--ink-400)]"
                    }`}
                  >
                    {form.is_active ? "Active" : "Inactive"}
                  </span>
                </div>
                {isSuperAdmin && form.brand_name && (
                  <p className="text-xs text-[var(--ink-400)] mt-0.5">
                    {form.brand_name}
                  </p>
                )}
                {form.system_type === "generic" && (
                  <p className="text-sm text-[var(--ink-600)] mt-1">
                    {form.submissions?.[0]?.count ?? 0} submissions
                  </p>
                )}
              </div>
              <div className="flex items-center gap-4 text-sm">
                {form.system_type === "asset" ? (
                  <>
                    <Link
                      href={`/admin/forms/${form.id}/assets/queue`}
                      className="text-[var(--pine-700)] hover:underline"
                    >
                      Verification queue
                    </Link>
                    <Link
                      href={`/admin/forms/${form.id}/assets/dashboard`}
                      className="text-[var(--pine-700)] hover:underline"
                    >
                      Dashboard
                    </Link>
                  </>
                ) : form.system_type === "coaching" ? (
                  <>
                    <Link
                      href={`/admin/forms/${form.id}/coaching/dashboard`}
                      className="text-[var(--pine-700)] hover:underline"
                    >
                      Dashboard
                    </Link>
                    <Link
                      href={`/admin/forms/${form.id}/coaching/master-data`}
                      className="text-[var(--pine-700)] hover:underline"
                    >
                      Master data
                    </Link>
                  </>
                ) : (
                  <>
                    <Link
                      href={`/admin/forms/${form.id}/dashboard`}
                      className="text-[var(--pine-700)] hover:underline"
                    >
                      Dashboard
                    </Link>
                    <Link
                      href={`/admin/forms/${form.id}/submissions`}
                      className="text-[var(--pine-700)] hover:underline"
                    >
                      View data
                    </Link>
                    <Link
                      href={`/admin/forms/${form.id}/edit`}
                      className="text-[var(--ink-600)] hover:text-[var(--pine-700)]"
                    >
                      Edit
                    </Link>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
