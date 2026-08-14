import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";
import UsersTable from "./UsersTable";

export default async function AdminUsersPage() {
  const supabase = await createClient();

  const {
    data: { user: currentUser },
  } = await supabase.auth.getUser();

  const { data: viewerProfile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", currentUser!.id)
    .single();
  const isSuperAdmin = viewerProfile?.role === "super_admin";
  const isAdmin = viewerProfile?.role === "admin";

  // RLS already scopes this to "unassigned + my allocated forms' users" for
  // a form admin, or everyone for a super admin — no extra filtering here.
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, status, assigned_form_id, field_role, manager_id, territory, created_at")
    .order("created_at", { ascending: false });

  let forms: { id: string; title: string; system_type: string }[] = [];
  if (isSuperAdmin) {
    forms = (await supabase.from("forms").select("id, title, system_type").order("title")).data ?? [];
  } else if (isAdmin) {
    const { data: allocations } = await supabase
      .from("admin_form_access")
      .select("forms(id, title, system_type)")
      .eq("admin_id", currentUser!.id);
    forms = ((allocations ?? []) as any[])
      .map((a) => a.forms)
      .filter(Boolean)
      .sort((a, b) => a.title.localeCompare(b.title));
  }

  // Super admin also needs every admin's current allocations, to render the
  // per-admin form-allocation checklist.
  let adminFormAccess: Record<string, string[]> = {};
  if (isSuperAdmin) {
    const { data: allAccess } = await supabase.from("admin_form_access").select("admin_id, form_id");
    adminFormAccess = (allAccess ?? []).reduce((acc: Record<string, string[]>, row) => {
      (acc[row.admin_id] ??= []).push(row.form_id);
      return acc;
    }, {});
  }

  // Principals (fed from Master Data) — only relevant to Team Leaders
  // assigned to coaching-system_type forms, used to render the "which
  // supplier(s) does this Team Leader serve" picker alongside their role.
  const coachingFormIds = forms.filter((f) => f.system_type === "coaching").map((f) => f.id);
  let principals: { id: string; name: string; form_id: string }[] = [];
  let teamLeaderPrincipals: Record<string, string[]> = {};
  let territories: { id: string; name: string; form_id: string }[] = [];
  if (coachingFormIds.length > 0) {
    const { data: principalRows } = await supabase
      .from("coaching_principals")
      .select("id, name, form_id")
      .in("form_id", coachingFormIds)
      .eq("is_active", true)
      .order("name");
    principals = principalRows ?? [];

    const { data: territoryRows } = await supabase
      .from("coaching_org_units")
      .select("id, name, form_id")
      .in("form_id", coachingFormIds)
      .eq("unit_type", "territory")
      .eq("is_active", true)
      .order("name");
    territories = territoryRows ?? [];

    const teamLeaderIds = (profiles ?? [])
      .filter((p) => p.field_role === "team_leader")
      .map((p) => p.id);
    if (teamLeaderIds.length > 0) {
      const { data: tlp } = await supabase
        .from("team_leader_principals")
        .select("team_leader_id, principal_id")
        .in("team_leader_id", teamLeaderIds);
      teamLeaderPrincipals = (tlp ?? []).reduce((acc: Record<string, string[]>, row) => {
        (acc[row.team_leader_id] ??= []).push(row.principal_id);
        return acc;
      }, {});
    }
  }

  return (
    <main className="flex-1 bg-[var(--sand-50)]">
      <div className="max-w-5xl mx-auto px-6 py-12">
        <p className="font-mono-label text-xs uppercase tracking-wider text-[var(--pine-600)] mb-2">
          Admin
        </p>
        <h1 className="font-display text-3xl text-[var(--ink-900)] mb-8">
          User accounts
        </h1>

        <UsersTable
          profiles={(profiles ?? []) as Profile[]}
          currentUserId={currentUser?.id ?? ""}
          isSuperAdmin={isSuperAdmin}
          forms={forms}
          adminFormAccess={adminFormAccess}
          principals={principals}
          teamLeaderPrincipals={teamLeaderPrincipals}
          territories={territories}
        />
      </div>
    </main>
  );
}
