import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { CANONICAL_MONTHS } from "@/lib/timeIntelligence";
import { getKnownPrincipals, getKnownMainPrincipals } from "@/lib/adminReference";
import { uploadTargetsAction, deleteTargetAction, createTargetAction, updateTargetAction } from "./actions";

export const dynamic = "force-dynamic";

const inputClass =
  "rounded-full border border-border bg-surface px-4 py-2 text-sm text-foreground outline-none focus:border-secondary-blue";
const labelClass = "text-[13px] font-medium text-muted-strong";

function fieldLabel(field: string): string {
  switch (field) {
    case "valueTarget":
      return "Value Target";
    case "volumeTarget":
      return "Volume Target";
    case "coverageTarget":
      return "Coverage Target";
    case "productivityTarget":
      return "Productivity Target";
    default:
      return field;
  }
}

export default async function AdminTargetsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; year?: string; edit?: string; principal?: string; mainPrincipal?: string }>;
}) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    redirect("/");
  }

  const { error, success, year: yearParam, edit, principal: lastPrincipal, mainPrincipal: lastMainPrincipal } = await searchParams;

  const distinctYears = await prisma.target.findMany({
    select: { year: true },
    distinct: ["year"],
    orderBy: { year: "desc" },
  });
  const years = distinctYears.map((r) => r.year);
  const year = yearParam && years.includes(yearParam) ? yearParam : years[0] || String(new Date().getFullYear());
  // Always offer the current calendar year and the one after, even before any target
  // exists for them yet — otherwise a brand-new deployment has nothing to pick from.
  const realYear = String(new Date().getFullYear());
  const yearOptions = Array.from(new Set([...years, realYear, String(Number(realYear) + 1)])).sort((a, b) => Number(b) - Number(a));

  const targets = await prisma.target.findMany({
    where: { year },
    orderBy: [{ monthIndex: "asc" }, { principal: "asc" }],
  });
  const editing = edit ? targets.find((t) => t.id === edit) : undefined;

  const auditLog = await prisma.targetAuditLog.findMany({
    orderBy: { timestamp: "desc" },
    take: 25,
  });

  const [knownPrincipals, knownMainPrincipals] = await Promise.all([getKnownPrincipals(), getKnownMainPrincipals()]);

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

        <div className="rounded-2xl bg-surface p-6 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
          <h2 className="text-lg font-semibold text-primary-blue">Add a target</h2>
          <p className="mt-1 text-[13px] text-muted">
            One row per Principal per Month. Adding a target that already exists for that Month/Principal will fail — edit it in the table instead.
          </p>
          <form action={createTargetAction} className="mt-4 grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div className="flex flex-col gap-2">
              <label className={labelClass}>Year</label>
              <select name="year" required defaultValue={year} className={inputClass}>
                {yearOptions.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <label className={labelClass}>Month</label>
              <select name="month" required defaultValue="" className={inputClass}>
                <option value="" disabled>
                  Select month
                </option>
                {CANONICAL_MONTHS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <label className={labelClass}>Principal</label>
              <select name="principal" defaultValue={lastPrincipal ?? ""} className={inputClass}>
                <option value="">— choose existing —</option>
                {knownPrincipals.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <label className={labelClass}>Or a new Principal</label>
              <input name="newPrincipal" placeholder="Bic-Nairobi" className={inputClass} />
            </div>
            <div className="flex flex-col gap-2">
              <label className={labelClass}>Main Principal</label>
              <input name="mainPrincipal" list="known-main-principals" defaultValue={lastMainPrincipal ?? ""} placeholder="Bic" className={inputClass} />
              <datalist id="known-main-principals">
                {knownMainPrincipals.map((mp) => (
                  <option key={mp} value={mp} />
                ))}
              </datalist>
            </div>
            <div className="flex flex-col gap-2">
              <label className={labelClass}>Value Target</label>
              <input name="valueTarget" type="number" step="any" className={inputClass} />
            </div>
            <div className="flex flex-col gap-2">
              <label className={labelClass}>Volume Target</label>
              <input name="volumeTarget" type="number" step="any" className={inputClass} />
            </div>
            <div className="flex flex-col gap-2">
              <label className={labelClass}>Coverage Target</label>
              <input name="coverageTarget" type="number" step="any" className={inputClass} />
            </div>
            <div className="flex flex-col gap-2">
              <label className={labelClass}>Productivity Target</label>
              <input name="productivityTarget" type="number" step="any" className={inputClass} />
            </div>
            <div className="sm:col-span-4">
              <button
                type="submit"
                className="rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-5 py-3 text-sm font-semibold text-white transition-all duration-300 hover:shadow-cyan-glow"
              >
                Add target
              </button>
            </div>
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
                {targets.map((t) =>
                  editing?.id === t.id ? (
                    <tr key={t.id} className="bg-accent-blue-soft/40">
                      <td colSpan={7} className="px-6 py-4 border-b border-border/60">
                        <form action={updateTargetAction} className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
                          <input type="hidden" name="targetId" value={t.id} />
                          <input type="hidden" name="year" value={year} />
                          <div className="flex flex-col gap-1">
                            <label className={labelClass}>Month</label>
                            <input value={t.month} disabled className={inputClass + " opacity-60"} />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className={labelClass}>Principal</label>
                            <input value={t.principal} disabled className={inputClass + " opacity-60"} />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className={labelClass}>Main Principal</label>
                            <input name="mainPrincipal" defaultValue={t.mainPrincipal ?? ""} className={inputClass} />
                          </div>
                          <div />
                          <div className="flex flex-col gap-1">
                            <label className={labelClass}>Value Target</label>
                            <input name="valueTarget" type="number" step="any" defaultValue={t.valueTarget ?? ""} className={inputClass} />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className={labelClass}>Volume Target</label>
                            <input name="volumeTarget" type="number" step="any" defaultValue={t.volumeTarget ?? ""} className={inputClass} />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className={labelClass}>Coverage Target</label>
                            <input name="coverageTarget" type="number" step="any" defaultValue={t.coverageTarget ?? ""} className={inputClass} />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className={labelClass}>Productivity Target</label>
                            <input name="productivityTarget" type="number" step="any" defaultValue={t.productivityTarget ?? ""} className={inputClass} />
                          </div>
                          <div className="flex gap-2 sm:col-span-4">
                            <button type="submit" className="rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-4 py-2 text-xs font-semibold text-white">
                              Save
                            </button>
                            <Link href={`/admin/targets?year=${encodeURIComponent(year)}`} className="rounded-full px-4 py-2 text-xs font-medium text-muted-strong hover:bg-background-elevated">
                              Cancel
                            </Link>
                          </div>
                        </form>
                      </td>
                    </tr>
                  ) : (
                    <tr key={t.id}>
                      <td className="px-6 py-3 border-b border-border/60">{t.month}</td>
                      <td className="px-6 py-3 border-b border-border/60">{t.principal}</td>
                      <td className="px-6 py-3 border-b border-border/60 text-right">{t.valueTarget ?? "—"}</td>
                      <td className="px-6 py-3 border-b border-border/60 text-right">{t.volumeTarget ?? "—"}</td>
                      <td className="px-6 py-3 border-b border-border/60 text-right">{t.coverageTarget ?? "—"}</td>
                      <td className="px-6 py-3 border-b border-border/60 text-right">{t.productivityTarget ?? "—"}</td>
                      <td className="px-6 py-3 border-b border-border/60 text-right whitespace-nowrap">
                        <Link
                          href={`/admin/targets?year=${encodeURIComponent(year)}&edit=${t.id}`}
                          className="inline-flex items-center gap-1 rounded-full px-3 py-2 text-xs font-medium text-primary-blue hover:bg-accent-blue-soft transition-colors duration-300"
                        >
                          Edit
                        </Link>
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
                  )
                )}
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

        <div className="rounded-2xl bg-surface overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
          <div className="p-6 pb-0">
            <h2 className="text-lg font-semibold text-primary-blue">Recent audit trail</h2>
            <p className="mt-1 text-[13px] text-muted">Last 25 row-level edits made through the Add/Edit/Remove form above (bulk uploads aren't logged here).</p>
          </div>
          <div className="overflow-x-auto mt-4">
            <table className="w-full text-sm border-collapse">
              <thead className="bg-background-elevated text-[13px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-6 py-3 text-left font-medium">When</th>
                  <th className="px-6 py-3 text-left font-medium">User</th>
                  <th className="px-6 py-3 text-left font-medium">Action</th>
                  <th className="px-6 py-3 text-left font-medium">Month / Principal</th>
                  <th className="px-6 py-3 text-left font-medium">Changes</th>
                </tr>
              </thead>
              <tbody>
                {auditLog.map((a) => {
                  const changes = a.changes as Record<string, { old: number | null; new: number | null }>;
                  return (
                    <tr key={a.id}>
                      <td className="px-6 py-3 border-b border-border/60 whitespace-nowrap">{new Date(a.timestamp).toLocaleString()}</td>
                      <td className="px-6 py-3 border-b border-border/60">{a.userEmail}</td>
                      <td className="px-6 py-3 border-b border-border/60">{a.action}</td>
                      <td className="px-6 py-3 border-b border-border/60">
                        {a.month} {a.year} — {a.principal}
                      </td>
                      <td className="px-6 py-3 border-b border-border/60">
                        <div className="flex flex-col gap-0.5">
                          {Object.entries(changes).map(([field, { old, new: next }]) => (
                            <span key={field} className="text-[13px]">
                              <span className="text-muted">{fieldLabel(field)}:</span> {old ?? "—"} → {next ?? "—"}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {auditLog.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-muted">
                      No edits logged yet.
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
