import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function CoachingHomePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: form } = await supabase.from("forms").select("id, title, brand_name").eq("id", id).single();
  if (!form) notFound();

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, field_role, role")
    .eq("id", user.id)
    .single();

  if (!profile?.field_role) {
    return (
      <main className="flex-1 bg-[var(--sand-50)]">
        <div className="max-w-md mx-auto px-6 py-20 text-center">
          <h1 className="font-display text-2xl text-[var(--ink-900)] mb-2">Not yet assigned a role</h1>
          <p className="text-[var(--ink-600)]">
            Your account is linked to {form.title} but hasn&apos;t been assigned a Team
            Leader/Sales Rep/Supervisor/Key Account Rep role yet. Contact your admin.
          </p>
        </div>
      </main>
    );
  }

  const today = new Date().toISOString().slice(0, 10);

  if (profile.field_role === "team_leader" || profile.field_role === "key_account_rep") {
    const isKeyAccountRep = profile.field_role === "key_account_rep";
    const [{ data: reps }, { data: pending }, { data: recent }] = await Promise.all([
      supabase
        .from("coaching_sales_reps")
        .select("id, full_name, email")
        .eq("form_id", id)
        .eq("team_leader_id", user.id)
        .eq("is_active", true),
      supabase
        .from("coaching_accompaniments")
        .select("id, sales_rep_id, date, status")
        .eq("team_leader_id", user.id)
        .in("status", ["draft", "submitted"])
        .order("date", { ascending: false }),
      supabase
        .from("coaching_accompaniments")
        .select("id, sales_rep_id, date, status, overall_score")
        .eq("team_leader_id", user.id)
        .order("date", { ascending: false })
        .limit(10),
    ]);
    const repName = (repId: string) => reps?.find((r) => r.id === repId)?.full_name ?? "—";

    return (
      <main className="flex-1 bg-[var(--sand-50)]">
        <div className="max-w-4xl mx-auto px-6 py-10">
          <p className="font-mono-label text-xs uppercase tracking-wider text-[var(--pine-600)] mb-2">
            {form.brand_name}
          </p>
          <h1 className="font-display text-3xl text-[var(--ink-900)] mb-1">
            Good day, {profile.full_name?.split(" ")[0] ?? (isKeyAccountRep ? "Key Account Rep" : "Team Leader")}
          </h1>
          <p className="text-sm text-[var(--ink-600)] mb-8">{today}</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
            <Link
              href={`/forms/${id}/coaching/new`}
              className="bg-[var(--pine-700)] text-white rounded-lg p-5 hover:bg-[var(--pine-900)] transition-colors"
            >
              <p className="font-display text-lg">{isKeyAccountRep ? "+ Log a Visit" : "+ Start Accompaniment"}</p>
              <p className="text-sm text-white/80 mt-1">
                {isKeyAccountRep ? "Record today's outlet visit" : "Pick a Sales Rep and begin today's visit"}
              </p>
            </Link>
            {!isKeyAccountRep && (
              <div className="bg-white border border-[var(--line)] rounded-lg p-5">
                <p className="font-display text-lg text-[var(--ink-900)]">{reps?.length ?? 0} Sales Reps</p>
                <p className="text-sm text-[var(--ink-600)] mt-1">assigned to you</p>
              </div>
            )}
          </div>

          <h2 className="font-display text-xl text-[var(--ink-900)] mb-3">Pending accompaniments</h2>
          <div className="space-y-2 mb-8">
            {(!pending || pending.length === 0) && (
              <p className="text-sm text-[var(--ink-400)]">No pending accompaniments.</p>
            )}
            {pending?.map((a) => (
              <Link
                key={a.id}
                href={`/forms/${id}/coaching/${a.id}`}
                className="block bg-white border border-[var(--line)] rounded-md px-4 py-3 hover:border-[var(--pine-500)]"
              >
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-[var(--ink-900)]">{repName(a.sales_rep_id)}</span>
                  <span className="text-[var(--ink-400)]">
                    {a.date} · {a.status}
                  </span>
                </div>
              </Link>
            ))}
          </div>

          <h2 className="font-display text-xl text-[var(--ink-900)] mb-3">Recent accompaniments</h2>
          <div className="space-y-2">
            {recent?.map((a) => (
              <div
                key={a.id}
                className="flex items-center justify-between text-sm bg-white border border-[var(--line)] rounded-md px-4 py-3"
              >
                <span className="font-medium text-[var(--ink-900)]">{repName(a.sales_rep_id)}</span>
                <span className="text-[var(--ink-600)]">
                  {a.date} · {a.overall_score != null ? `${a.overall_score}%` : "—"} · {a.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      </main>
    );
  }

  // field_role === "supervisor" (sales reps have no login of their own —
  // they're a roster the Team Leader manages, see coaching_sales_reps)
  const { data: teamLeaders } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("manager_id", user.id);
  const { data: pendingReview } = await supabase
    .from("coaching_accompaniments")
    .select("id, team_leader_id, sales_rep_id, date")
    .in("status", ["submitted", "sales_rep_acknowledged"])
    .order("date", { ascending: false });

  return (
    <main className="flex-1 bg-[var(--sand-50)]">
      <div className="max-w-3xl mx-auto px-6 py-10">
        <p className="font-mono-label text-xs uppercase tracking-wider text-[var(--pine-600)] mb-2">
          {form.brand_name}
        </p>
        <h1 className="font-display text-3xl text-[var(--ink-900)] mb-1">
          Welcome, {profile.full_name?.split(" ")[0] ?? "Supervisor"}
        </h1>
        <p className="text-sm text-[var(--ink-600)] mb-8">
          {teamLeaders?.length ?? 0} Team Leaders reporting to you
        </p>

        <Link
          href={`/forms/${id}/coaching/review`}
          className="block bg-[var(--pine-700)] text-white rounded-lg p-5 hover:bg-[var(--pine-900)] mb-8"
        >
          <p className="font-display text-lg">Review queue</p>
          <p className="text-sm text-white/80 mt-1">
            {pendingReview?.length ?? 0} accompaniments awaiting your review
          </p>
        </Link>
      </div>
    </main>
  );
}
