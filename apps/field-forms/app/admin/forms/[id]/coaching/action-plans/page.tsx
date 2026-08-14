import { createClient } from "@/lib/supabase/server";
import { ACTION_STATUSES, type ActionStatus } from "@/lib/coachingTypes";

const STATUS_STYLE: Record<ActionStatus, string> = {
  open: "bg-[var(--sand-100)] text-[var(--ink-600)]",
  in_progress: "bg-[var(--pine-100)] text-[var(--pine-700)]",
  completed: "bg-[var(--pine-100)] text-[var(--pine-700)]",
  overdue: "bg-[#f5e2dd] text-[var(--rust-600)]",
  verified: "bg-[var(--pine-100)] text-[var(--pine-700)]",
  closed: "bg-[var(--sand-100)] text-[var(--ink-400)]",
};

const PRIORITY_STYLE: Record<string, string> = {
  low: "text-[var(--ink-400)]",
  medium: "text-[var(--ink-600)]",
  high: "text-[var(--rust-600)]",
  critical: "text-[var(--rust-600)] font-medium",
};

// Tenant-wide view of every action plan raised across every accompaniment
// (self-visits included) — the admin-side counterpart to the "All
// Accompaniments" review queue. RLS (can_manage_form) already scopes this
// correctly for admins/super admins; nothing further to filter here.
export default async function ActionPlansPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { id } = await params;
  const { status: statusFilter } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("coaching_action_plans")
    .select("*, coaching_accompaniments!inner(id, form_id, team_leader_id, sales_rep_id, date)")
    .eq("coaching_accompaniments.form_id", id)
    .order("target_date", { ascending: true, nullsFirst: false })
    .limit(300);
  if (statusFilter && (ACTION_STATUSES as readonly string[]).includes(statusFilter)) {
    query = query.eq("status", statusFilter);
  }
  const { data: plans } = await query;

  const teamLeaderIds = Array.from(new Set((plans ?? []).map((p: any) => p.coaching_accompaniments.team_leader_id)));
  const ownerIds = Array.from(new Set((plans ?? []).map((p: any) => p.owner_id)));
  const [{ data: teamLeaders }, { data: owners }] = await Promise.all([
    teamLeaderIds.length
      ? supabase.from("profiles").select("id, full_name").in("id", teamLeaderIds)
      : Promise.resolve({ data: [] }),
    ownerIds.length
      ? supabase.from("coaching_sales_reps").select("id, full_name").in("id", ownerIds)
      : Promise.resolve({ data: [] }),
  ]);
  const teamLeaderName = (pid: string) => teamLeaders?.find((p) => p.id === pid)?.full_name ?? "—";
  const ownerName = (pid: string) => owners?.find((o) => o.id === pid)?.full_name ?? "—";

  const today = new Date().toISOString().slice(0, 10);
  const isOverdue = (p: any) => p.target_date && p.target_date < today && !["completed", "verified", "closed"].includes(p.status);

  const counts = ACTION_STATUSES.reduce((acc, s) => {
    acc[s] = (plans ?? []).filter((p: any) => p.status === s).length;
    return acc;
  }, {} as Record<ActionStatus, number>);

  return (
    <main className="flex-1 bg-[var(--sand-50)]">
      <div className="max-w-6xl mx-auto px-6 pb-16">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
          <h1 className="font-display text-3xl text-[var(--ink-900)]">Action Plans</h1>
          <div className="flex flex-wrap gap-2 text-xs">
            <a
              href={`?`}
              className={`rounded-full px-3 py-1 border ${!statusFilter ? "bg-[var(--pine-700)] text-white border-[var(--pine-700)]" : "border-[var(--line)] text-[var(--ink-600)] hover:border-[var(--pine-500)]"}`}
            >
              All ({(plans ?? []).length})
            </a>
            {ACTION_STATUSES.map((s) => (
              <a
                key={s}
                href={`?status=${s}`}
                className={`rounded-full px-3 py-1 border ${statusFilter === s ? "bg-[var(--pine-700)] text-white border-[var(--pine-700)]" : "border-[var(--line)] text-[var(--ink-600)] hover:border-[var(--pine-500)]"}`}
              >
                {s.replace(/_/g, " ")} ({counts[s]})
              </a>
            ))}
          </div>
        </div>

        {(!plans || plans.length === 0) && (
          <p className="text-sm text-[var(--ink-400)]">No action plans{statusFilter ? ` with status "${statusFilter}"` : ""} yet.</p>
        )}

        {plans && plans.length > 0 && (
          <div className="overflow-x-auto bg-white border border-[var(--line)] rounded-lg">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-[var(--ink-400)] border-b border-[var(--line)] bg-[var(--sand-50)]">
                  <th className="py-2 px-3">Issue</th>
                  <th className="py-2 px-3">Owner</th>
                  <th className="py-2 px-3">Team Leader</th>
                  <th className="py-2 px-3">Area</th>
                  <th className="py-2 px-3">Priority</th>
                  <th className="py-2 px-3">Due</th>
                  <th className="py-2 px-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {plans.map((p: any) => (
                  <tr key={p.id} className="border-b border-[var(--line)] last:border-0">
                    <td className="py-2 px-3 max-w-[280px]">
                      <p className="text-[var(--ink-900)]">{p.issue}</p>
                      <p className="text-xs text-[var(--ink-500)] mt-0.5">{p.required_action}</p>
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap">{ownerName(p.owner_id)}</td>
                    <td className="py-2 px-3 whitespace-nowrap text-[var(--ink-600)]">
                      {teamLeaderName(p.coaching_accompaniments.team_leader_id)}
                    </td>
                    <td className="py-2 px-3 text-[var(--ink-600)]">{p.coaching_area ?? "—"}</td>
                    <td className={`py-2 px-3 ${PRIORITY_STYLE[p.priority] ?? ""}`}>{p.priority}</td>
                    <td className={`py-2 px-3 whitespace-nowrap ${isOverdue(p) ? "text-[var(--rust-600)] font-medium" : "text-[var(--ink-600)]"}`}>
                      {p.target_date ?? "—"}
                      {isOverdue(p) && " (overdue)"}
                    </td>
                    <td className="py-2 px-3">
                      <span className={`text-xs rounded-full px-2 py-0.5 whitespace-nowrap ${STATUS_STYLE[p.status as ActionStatus] ?? ""}`}>
                        {p.status.replace(/_/g, " ")}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
