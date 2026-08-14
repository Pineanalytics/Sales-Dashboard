import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function ReviewQueuePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: accompaniments } = await supabase
    .from("coaching_accompaniments")
    .select("id, date, status, overall_score, team_leader_id, sales_rep_id")
    .in("status", ["submitted", "sales_rep_acknowledged"])
    .order("date", { ascending: false });

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
      <div className="max-w-3xl mx-auto px-6 py-10">
        <h1 className="font-display text-3xl text-[var(--ink-900)] mb-6">Supervisor Review Queue</h1>

        {(!accompaniments || accompaniments.length === 0) && (
          <p className="text-sm text-[var(--ink-400)]">Nothing awaiting review.</p>
        )}

        <div className="space-y-2">
          {accompaniments?.map((a) => (
            <Link
              key={a.id}
              href={`/forms/${id}/coaching/review/${a.id}`}
              className="block bg-white border border-[var(--line)] rounded-md px-4 py-3 hover:border-[var(--pine-500)]"
            >
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-[var(--ink-900)] flex items-center gap-2">
                  {isSelfVisit(a.team_leader_id) ? (
                    <>
                      <span className="text-[10px] font-mono-label uppercase tracking-wide bg-[var(--sand-100)] text-[var(--ink-600)] rounded px-1.5 py-0.5">
                        Self Visit
                      </span>
                      {teamLeaderName(a.team_leader_id)}
                    </>
                  ) : (
                    <>
                      {teamLeaderName(a.team_leader_id)} → {repName(a.sales_rep_id)}
                    </>
                  )}
                </span>
                <span className="text-[var(--ink-600)]">
                  {a.date} · {a.overall_score != null ? `${a.overall_score}%` : "—"} · {a.status.replace(/_/g, " ")}
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
