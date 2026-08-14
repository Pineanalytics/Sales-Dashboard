import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import DeleteAccompanimentButton from "./DeleteAccompanimentButton";

// Back-Office/Super Admin oversight of the same review queue Supervisors
// use — RLS (can_manage_form) naturally returns every accompaniment in the
// tenant here, versus just a Supervisor's own reporting chain on the
// user-facing /forms/[id]/coaching/review page.
export default async function AdminReviewQueuePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: viewerProfile } = user
    ? await supabase.from("profiles").select("role").eq("id", user.id).single()
    : { data: null };
  const isSuperAdmin = viewerProfile?.role === "super_admin";

  const { data: accompaniments } = await supabase
    .from("coaching_accompaniments")
    .select("id, date, status, overall_score, team_leader_id, sales_rep_id")
    .order("date", { ascending: false })
    .limit(100);

  const teamLeaderIds = Array.from(new Set((accompaniments ?? []).map((a) => a.team_leader_id)));
  const repIds = Array.from(new Set((accompaniments ?? []).map((a) => a.sales_rep_id)));
  const [{ data: teamLeaders }, { data: reps }] = await Promise.all([
    teamLeaderIds.length
      ? supabase.from("profiles").select("id, full_name, field_role").in("id", teamLeaderIds)
      : Promise.resolve({ data: [] }),
    repIds.length
      ? supabase.from("coaching_sales_reps").select("id, full_name").in("id", repIds)
      : Promise.resolve({ data: [] }),
  ]);
  const teamLeaderName = (pid: string) => teamLeaders?.find((p) => p.id === pid)?.full_name ?? "—";
  const repName = (pid: string) => reps?.find((p) => p.id === pid)?.full_name ?? "—";
  const isSelfVisit = (teamLeaderId: string) =>
    teamLeaders?.find((p) => p.id === teamLeaderId)?.field_role === "key_account_rep";

  return (
    <main className="flex-1 bg-[var(--sand-50)]">
      <div className="max-w-5xl mx-auto px-6 pb-16">
        <h1 className="font-display text-3xl text-[var(--ink-900)] mb-6">All Accompaniments</h1>
        <table className="w-full text-sm bg-white border border-[var(--line)] rounded-lg overflow-hidden">
          <thead>
            <tr className="text-left text-[var(--ink-400)] border-b border-[var(--line)] bg-[var(--sand-50)]">
              <th className="py-2 px-3">Team Leader</th>
              <th className="py-2 px-3">Sales Rep</th>
              <th className="py-2 px-3">Date</th>
              <th className="py-2 px-3">Score</th>
              <th className="py-2 px-3">Status</th>
              {isSuperAdmin && <th className="py-2 px-3"></th>}
            </tr>
          </thead>
          <tbody>
            {accompaniments?.map((a) => (
              <tr key={a.id} className="border-b border-[var(--line)]">
                <td className="py-2 px-3 flex items-center gap-2">
                  {isSelfVisit(a.team_leader_id) && (
                    <span className="text-[10px] font-mono-label uppercase tracking-wide bg-[var(--sand-100)] text-[var(--ink-600)] rounded px-1.5 py-0.5">
                      Self Visit
                    </span>
                  )}
                  {teamLeaderName(a.team_leader_id)}
                </td>
                <td className="py-2 px-3">{repName(a.sales_rep_id)}</td>
                <td className="py-2 px-3 text-[var(--ink-600)]">{a.date}</td>
                <td className="py-2 px-3 text-[var(--ink-600)]">
                  {a.overall_score != null ? `${a.overall_score}%` : "—"}
                </td>
                <td className="py-2 px-3 text-[var(--ink-600)]">
                  {a.status.replace(/_/g, " ")}
                  {["submitted", "sales_rep_acknowledged"].includes(a.status) && (
                    <Link
                      href={`/forms/${id}/coaching/review/${a.id}`}
                      className="ml-2 text-[var(--pine-700)] hover:underline"
                    >
                      Review
                    </Link>
                  )}
                </td>
                {isSuperAdmin && (
                  <td className="py-2 px-3">
                    <DeleteAccompanimentButton id={a.id} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
