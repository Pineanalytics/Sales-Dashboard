import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, assigned_form_id")
    .eq("id", user.id)
    .single();

  // Regular users only ever have one form to work with — skip the picker
  // and take them straight there.
  if (profile?.role === "user") {
    if (profile?.assigned_form_id) {
      const { data: assignedForm } = await supabase
        .from("forms")
        .select("system_type")
        .eq("id", profile.assigned_form_id)
        .single();
      const suffix =
        assignedForm?.system_type === "asset"
          ? "/assets"
          : assignedForm?.system_type === "coaching"
            ? "/coaching"
            : "";
      redirect(`/forms/${profile.assigned_form_id}${suffix}`);
    }
    return (
      <main className="flex-1 bg-[var(--sand-50)]">
        <div className="max-w-md mx-auto px-6 py-20 text-center">
          <h1 className="font-display text-2xl text-[var(--ink-900)] mb-2">
            No form assigned yet
          </h1>
          <p className="text-[var(--ink-600)]">
            Your account isn&apos;t linked to a form. Contact your admin to get
            assigned to one.
          </p>
        </div>
      </main>
    );
  }

  // A form admin can be allocated more than one form — if they have exactly
  // one, skip the picker like before; otherwise (zero or several) fall
  // through to the picker below, scoped to their allocated set.
  let allocatedFormIds: string[] | null = null;
  if (profile?.role === "admin") {
    const { data: allocations } = await supabase
      .from("admin_form_access")
      .select("form_id")
      .eq("admin_id", user.id);
    allocatedFormIds = (allocations ?? []).map((a) => a.form_id);

    if (allocatedFormIds.length === 1) {
      const { data: assignedForm } = await supabase
        .from("forms")
        .select("system_type")
        .eq("id", allocatedFormIds[0])
        .single();
      const suffix =
        assignedForm?.system_type === "asset"
          ? "/assets"
          : assignedForm?.system_type === "coaching"
            ? "/coaching"
            : "";
      redirect(`/forms/${allocatedFormIds[0]}${suffix}`);
    }
    if (allocatedFormIds.length === 0) {
      return (
        <main className="flex-1 bg-[var(--sand-50)]">
          <div className="max-w-md mx-auto px-6 py-20 text-center">
            <h1 className="font-display text-2xl text-[var(--ink-900)] mb-2">
              No forms allocated yet
            </h1>
            <p className="text-[var(--ink-600)]">
              Ask a super admin to allocate a form to your account.
            </p>
          </div>
        </main>
      );
    }
  }

  let formsQuery = supabase
    .from("forms")
    .select("id, title, description, is_active, brand_name, system_type, created_at")
    .order("created_at", { ascending: false });
  if (allocatedFormIds) {
    formsQuery = formsQuery.in("id", allocatedFormIds);
  }
  const { data: forms } = await formsQuery;

  return (
    <main className="flex-1 bg-[var(--sand-50)]">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <div className="mb-8">
          <p className="font-mono-label text-xs uppercase tracking-wider text-[var(--pine-600)] mb-2">
            {allocatedFormIds ? "Your forms" : "All forms"}
          </p>
          <h1 className="font-display text-3xl text-[var(--ink-900)]">
            {allocatedFormIds ? "Pick a form to work with" : "Every form across every agency"}
          </h1>
        </div>

        {(!forms || forms.length === 0) && (
          <div className="border border-dashed border-[var(--line)] rounded-lg p-10 text-center text-[var(--ink-600)]">
            No forms have been created yet.
          </div>
        )}

        <ul className="space-y-3">
          {(forms as any[] | null)?.map((form) => (
            <li key={form.id}>
              <Link
                href={`/forms/${form.id}${
                  form.system_type === "asset"
                    ? "/assets"
                    : form.system_type === "coaching"
                      ? "/coaching"
                      : ""
                }`}
                className="block bg-white border border-[var(--line)] rounded-lg px-5 py-4 hover:border-[var(--pine-500)] transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="font-display text-lg text-[var(--ink-900)]">
                      {form.title}
                    </h2>
                    {form.brand_name && (
                      <p className="text-xs text-[var(--ink-400)] mt-0.5">
                        {form.brand_name}
                      </p>
                    )}
                    {form.description && (
                      <p className="text-sm text-[var(--ink-600)] mt-1">
                        {form.description}
                      </p>
                    )}
                  </div>
                  <span
                    className={`shrink-0 text-xs font-mono-label uppercase tracking-wide rounded-full px-2.5 py-1 ${
                      form.is_active
                        ? "bg-[var(--pine-100)] text-[var(--pine-700)]"
                        : "bg-[var(--sand-100)] text-[var(--ink-400)]"
                    }`}
                  >
                    {form.is_active ? "Active" : "Inactive"}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
