import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { CANONICAL_MONTHS } from "@/lib/timeIntelligence";
import { getKnownPrincipals, getKnownMainPrincipals } from "@/lib/adminReference";
import { AdminBadge, AdminCard, AdminDisclosure, AdminNotices, AdminPage, adminTable, searchText } from "@/components/admin/AdminPage";
import { AdminTableSearch } from "@/components/admin/AdminTableSearch";
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
  searchParams: Promise<{ error?: string; success?: string; year?: string; edit?: string; principal?: string; mainPrincipal?: string; filterPrincipal?: string }>;
}) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    redirect("/");
  }

  const { error, success, year: yearParam, edit, principal: lastPrincipal, mainPrincipal: lastMainPrincipal, filterPrincipal } = await searchParams;

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
    where: { year, ...(filterPrincipal ? { principal: filterPrincipal } : {}) },
    orderBy: [{ monthIndex: "asc" }, { principal: "asc" }],
  });
  const editing = edit ? targets.find((t) => t.id === edit) : undefined;

  const auditLog = await prisma.targetAuditLog.findMany({
    orderBy: { timestamp: "desc" },
    take: 25,
  });

  const [knownPrincipals, knownMainPrincipals] = await Promise.all([getKnownPrincipals(), getKnownMainPrincipals()]);

  return (
    <AdminPage
      title="Targets"
      description="The Value Target is the executive dashboard's editable full-month mission. Weekly and daily targets, required run rates, and projection are recalculated from it without overwriting this plan."
      stats={[
        { label: `targets in ${year}`, value: targets.length },
        { label: "principals", value: new Set(targets.map((t) => t.principal)).size },
      ]}
    >
      <AdminNotices error={error} success={success} />

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <AdminCard title="Upload targets" description={<>Expects a &quot;Targets Per Principal&quot;-shaped sheet: Period, Principal, Main Principal, Value/Volume/Coverage/Productivity Target.</>}>
          <form action={uploadTargetsAction} className="flex flex-wrap items-center gap-3">
            <input
              type="file"
              name="file"
              accept=".xlsx,.xls,.xlsm"
              required
              className="text-sm text-foreground file:mr-4 file:rounded-full file:border-0 file:bg-background-elevated file:px-4 file:py-2 file:text-sm file:font-medium file:text-primary-blue hover:file:bg-accent-blue-soft"
            />
            <button
              type="submit"
              className="rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-5 py-2.5 text-sm font-semibold text-white transition-all duration-300 hover:shadow-cyan-glow"
            >
              Upload
            </button>
          </form>
        </AdminCard>

        <AdminDisclosure
          title="Add a target"
          description="One row per Principal per Month. This Value Target governs the Executive module's working-day pacing; change it here rather than editing a derived weekly or daily run rate."
          defaultOpen={Boolean(lastPrincipal)}
        >
          <form action={createTargetAction} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
              <label className={labelClass}>Productive Calls Target</label>
              <input name="productivityTarget" type="number" step="any" className={inputClass} />
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <button
                type="submit"
                className="rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-5 py-2.5 text-sm font-semibold text-white transition-all duration-300 hover:shadow-cyan-glow"
              >
                Add target
              </button>
            </div>
          </form>
        </AdminDisclosure>
      </div>

        <AdminCard
          flush
          title={<>Targets {year} <AdminBadge>{targets.length}</AdminBadge></>}
          actions={
            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              <AdminTableSearch target="targets" placeholder="Search month or principal" />
              <form method="get" className="flex items-center gap-2">
                <input type="hidden" name="year" value={year} />
                <label className="sr-only" htmlFor="target-principal-filter">Filter targets by principal</label>
                <select id="target-principal-filter" name="filterPrincipal" defaultValue={filterPrincipal ?? ""} className={inputClass}>
                  <option value="">All principals</option>
                  {knownPrincipals.map((principal) => (
                    <option key={principal} value={principal}>{principal}</option>
                  ))}
                </select>
                <button type="submit" className="rounded-full bg-background-elevated px-3 py-2 text-xs font-semibold text-primary-blue hover:bg-accent-blue-soft">Filter</button>
                {filterPrincipal ? <Link href={`/admin/targets?year=${encodeURIComponent(year)}`} className="text-xs font-medium text-muted-strong hover:text-primary-blue">Clear</Link> : null}
              </form>
              {years.length > 1 ? (
                years.map((y) => (
                  <Link
                    key={y}
                    href={`/admin/targets?year=${encodeURIComponent(y)}${filterPrincipal ? `&filterPrincipal=${encodeURIComponent(filterPrincipal)}` : ""}`}
                    className={`rounded-full px-3 py-1.5 font-medium transition-colors ${
                      y === year ? "bg-gradient-to-r from-primary-blue to-secondary-blue text-white" : "bg-background-elevated text-muted-strong hover:bg-accent-blue-soft"
                    }`}
                  >
                    {y}
                  </Link>
                ))
              ) : null}
            </div>
          }
        >
          <div className="overflow-x-auto" data-filter-root="targets">
            <table className={adminTable.table}>
              <thead className={adminTable.head}>
                <tr>
                  <th className={adminTable.th}>Month</th>
                  <th className={adminTable.th}>Principal</th>
                  <th className={adminTable.thRight}>Value Target</th>
                  <th className={adminTable.thRight}>Volume Target</th>
                  <th className={adminTable.thRight}>Coverage Target</th>
                  <th className={adminTable.thRight}>Productive Calls Target</th>
                  <th className={adminTable.thRight}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {targets.map((t) =>
                  editing?.id === t.id ? (
                    <tr key={t.id} className="bg-accent-blue-soft/40">
                      <td colSpan={7} className="border-b border-border/60 px-4 py-4">
                        <form action={updateTargetAction} className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
                          <input type="hidden" name="targetId" value={t.id} />
                          <input type="hidden" name="year" value={year} />
                          {filterPrincipal ? <input type="hidden" name="filterPrincipal" value={filterPrincipal} /> : null}
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
                            <label className={labelClass}>Productive Calls Target</label>
                            <input name="productivityTarget" type="number" step="any" defaultValue={t.productivityTarget ?? ""} className={inputClass} />
                          </div>
                          <div className="flex gap-2 sm:col-span-4">
                            <button type="submit" className="rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-4 py-2 text-xs font-semibold text-white">
                              Save
                            </button>
                            <Link href={`/admin/targets?year=${encodeURIComponent(year)}${filterPrincipal ? `&filterPrincipal=${encodeURIComponent(filterPrincipal)}` : ""}`} className="rounded-full px-4 py-2 text-xs font-medium text-muted-strong hover:bg-background-elevated">
                              Cancel
                            </Link>
                          </div>
                        </form>
                      </td>
                    </tr>
                  ) : (
                    <tr key={t.id} data-search={searchText(t.month, t.principal, t.mainPrincipal)}>
                      <td className={adminTable.td}>{t.month}</td>
                      <td className={adminTable.td}>{t.principal}</td>
                      <td className={adminTable.tdRight}>{t.valueTarget ?? "—"}</td>
                      <td className={adminTable.tdRight}>{t.volumeTarget ?? "—"}</td>
                      <td className={adminTable.tdRight}>{t.coverageTarget ?? "—"}</td>
                      <td className={adminTable.tdRight}>{t.productivityTarget ?? "—"}</td>
                      <td className={`${adminTable.tdRight} whitespace-nowrap`}>
                        <Link
                          href={`/admin/targets?year=${encodeURIComponent(year)}&edit=${t.id}${filterPrincipal ? `&filterPrincipal=${encodeURIComponent(filterPrincipal)}` : ""}`}
                          className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium text-primary-blue hover:bg-accent-blue-soft transition-colors duration-300"
                        >
                          Edit
                        </Link>
                        <form action={deleteTargetAction} className="inline">
                          <input type="hidden" name="targetId" value={t.id} />
                          <input type="hidden" name="year" value={year} />
                          {filterPrincipal ? <input type="hidden" name="filterPrincipal" value={filterPrincipal} /> : null}
                          <button
                            type="submit"
                            className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium text-accent-red hover:bg-accent-red-soft transition-colors duration-300"
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
                    <td colSpan={7} className={adminTable.empty}>
                      No targets for {year} yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </AdminCard>

        <AdminDisclosure
          title="Recent audit trail"
          badge={<AdminBadge>{auditLog.length}</AdminBadge>}
          description="Last 25 row-level edits made through the Add/Edit/Remove forms (bulk uploads aren't logged here)."
        >
          <div className="-mx-5 -mb-5 overflow-x-auto">
            <table className={adminTable.table}>
              <thead className={adminTable.head}>
                <tr>
                  <th className={adminTable.th}>When</th>
                  <th className={adminTable.th}>User</th>
                  <th className={adminTable.th}>Action</th>
                  <th className={adminTable.th}>Month / Principal</th>
                  <th className={adminTable.th}>Changes</th>
                </tr>
              </thead>
              <tbody>
                {auditLog.map((a) => {
                  const changes = a.changes as Record<string, { old: number | null; new: number | null }>;
                  return (
                    <tr key={a.id}>
                      <td className={`${adminTable.td} whitespace-nowrap`}>{new Date(a.timestamp).toLocaleString()}</td>
                      <td className={adminTable.td}>{a.userEmail}</td>
                      <td className={adminTable.td}>{a.action}</td>
                      <td className={adminTable.td}>
                        {a.month} {a.year} — {a.principal}
                      </td>
                      <td className={adminTable.td}>
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
                    <td colSpan={5} className={adminTable.empty}>
                      No edits logged yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </AdminDisclosure>
    </AdminPage>
  );
}
