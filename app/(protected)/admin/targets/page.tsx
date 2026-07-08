import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { uploadTargetsAction, deleteTargetAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function AdminTargetsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; year?: string }>;
}) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    redirect("/");
  }

  const { error, success, year: yearParam } = await searchParams;

  const distinctYears = await prisma.target.findMany({
    select: { year: true },
    distinct: ["year"],
    orderBy: { year: "desc" },
  });
  const years = distinctYears.map((r) => r.year);
  const year = yearParam && years.includes(yearParam) ? yearParam : years[0] || String(new Date().getFullYear());

  const targets = await prisma.target.findMany({
    where: { year },
    orderBy: [{ monthIndex: "asc" }, { principal: "asc" }],
  });

  return (
    <div className="min-h-screen bg-background">
      <div className="bg-gradient-to-br from-dark-navy to-primary-blue px-4 md:px-8 py-6 md:py-7 shadow-[0_2px_10px_rgba(10,31,82,0.25)]">
        <Link href="/admin" className="inline-flex items-center gap-2 text-xs font-medium text-white/80 hover:text-brand-orange transition-colors">
          ← Back to admin
        </Link>
        <h1 className="mt-3 text-[26px] md:text-[34px] font-bold text-white leading-tight">Targets</h1>
        <p className="mt-1 text-sm text-white/70">
          Upload monthly targets independently of the full Sales/Stock/Coverage refresh. Re-uploading the same month/principal updates it in place.
        </p>
      </div>

      <div className="max-w-5xl mx-auto p-4 md:p-8 flex flex-col gap-6">
        {error ? (
          <p className="rounded-xl border-l-4 border-l-accent-red bg-surface px-4 py-3 text-sm text-accent-red shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
            {error}
          </p>
        ) : null}
        {success ? (
          <p className="rounded-xl border-l-4 border-l-accent-green bg-surface px-4 py-3 text-sm text-accent-green shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
            {success}
          </p>
        ) : null}

        <div className="rounded-2xl bg-surface p-6 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
          <h2 className="text-lg font-semibold text-primary-blue">Upload targets</h2>
          <p className="mt-1 text-[13px] text-muted">
            Expects a "Targets Per Principal"-shaped sheet: Period, Principal, Main Principal, Value/Volume/Coverage/Productivity Target.
          </p>
          <form action={uploadTargetsAction} className="mt-4 flex flex-wrap items-center gap-4">
            <input
              type="file"
              name="file"
              accept=".xlsx,.xls,.xlsm"
              required
              className="text-sm text-foreground file:mr-4 file:rounded-full file:border-0 file:bg-background-elevated file:px-4 file:py-2 file:text-sm file:font-medium file:text-primary-blue hover:file:bg-accent-blue-soft"
            />
            <button
              type="submit"
              className="rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-5 py-3 text-sm font-semibold text-white transition-all duration-300 hover:shadow-cyan-glow"
            >
              Upload
            </button>
          </form>
        </div>

        <div className="rounded-2xl bg-surface overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
          <div className="p-6 pb-0 flex items-center justify-between flex-wrap gap-3">
            <h2 className="text-lg font-semibold text-primary-blue">Targets ({targets.length})</h2>
            {years.length > 1 ? (
              <div className="flex items-center gap-2 text-[13px]">
                {years.map((y) => (
                  <Link
                    key={y}
                    href={`/admin/targets?year=${encodeURIComponent(y)}`}
                    className={`rounded-full px-3 py-1.5 font-medium transition-colors ${
                      y === year ? "bg-gradient-to-r from-primary-blue to-secondary-blue text-white" : "bg-background-elevated text-muted-strong hover:bg-accent-blue-soft"
                    }`}
                  >
                    {y}
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
          <div className="overflow-x-auto mt-4">
            <table className="w-full text-sm border-collapse">
              <thead className="bg-background-elevated text-[13px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-6 py-3 text-left font-medium">Month</th>
                  <th className="px-6 py-3 text-left font-medium">Principal</th>
                  <th className="px-6 py-3 text-right font-medium">Value Target</th>
                  <th className="px-6 py-3 text-right font-medium">Volume Target</th>
                  <th className="px-6 py-3 text-right font-medium">Coverage Target</th>
                  <th className="px-6 py-3 text-right font-medium">Productivity Target</th>
                  <th className="px-6 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {targets.map((t) => (
                  <tr key={t.id}>
                    <td className="px-6 py-3 border-b border-border/60">{t.month}</td>
                    <td className="px-6 py-3 border-b border-border/60">{t.principal}</td>
                    <td className="px-6 py-3 border-b border-border/60 text-right">{t.valueTarget ?? "—"}</td>
                    <td className="px-6 py-3 border-b border-border/60 text-right">{t.volumeTarget ?? "—"}</td>
                    <td className="px-6 py-3 border-b border-border/60 text-right">{t.coverageTarget ?? "—"}</td>
                    <td className="px-6 py-3 border-b border-border/60 text-right">{t.productivityTarget ?? "—"}</td>
                    <td className="px-6 py-3 border-b border-border/60 text-right">
                      <form action={deleteTargetAction} className="inline">
                        <input type="hidden" name="targetId" value={t.id} />
                        <input type="hidden" name="year" value={year} />
                        <button
                          type="submit"
                          className="inline-flex items-center gap-1 rounded-full px-3 py-2 text-xs font-medium text-accent-red hover:bg-accent-red-soft transition-colors duration-300"
                        >
                          Remove
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
                {targets.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-8 text-center text-muted">
                      No targets for {year} yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
