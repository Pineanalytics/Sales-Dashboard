import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AdminBadge, AdminCard, AdminPage, adminTable } from "@/components/admin/AdminPage";
import { RefreshSyncButton } from "@/components/admin/RefreshSyncButton";
import { RosterLinkPicker } from "@/components/admin/RosterLinkPicker";
import { getRepDirectoryOverview, REP_DIRECTORY_PAGE_SIZE } from "@/lib/repDirectory";
import { REP_SOURCES, REP_SOURCE_LABELS, type RepSource } from "@/lib/repDirectoryBuild";
import { SYNC_JOB_INFO, type SyncJobName } from "@/lib/syncJobs";

export const dynamic = "force-dynamic";

const inputClass = "rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-secondary-blue";

type SearchParams = { q?: string; source?: string; status?: string; roster?: string; field?: string };

/** The jobs behind each source, for its Refresh now button. */
const SOURCE_JOBS: Record<RepSource, SyncJobName> = {
  SAP: "sap-reps",
  PINE: "pine-reps",
  LEVERAGE: "rep-directory",
  DATAEDGE: "rep-directory",
  EABL_DMS: "rep-directory",
};

function when(date: Date | null): string {
  return date ? date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "No activity";
}

function whenTime(date: Date | null): string {
  return date ? date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Never";
}

function href(params: SearchParams, change: Partial<SearchParams>): string {
  const merged = { ...params, ...change };
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) if (value) search.set(key, value);
  const text = search.toString();
  return text ? `/admin/rep-directory?${text}` : "/admin/rep-directory";
}

export default async function RepDirectoryPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") redirect("/");

  const params = await searchParams;
  const status = params.status === "inactive" || params.status === "all" ? params.status : "active";
  const overview = await getRepDirectoryOverview({
    q: params.q,
    source: params.source,
    status,
    roster: params.roster,
    fieldRepsOnly: params.field === "1",
  });
  const filtersActive = Boolean(params.q || params.source || params.roster || params.field || status !== "active");
  const totalIdentities = overview.bySource.reduce((sum, row) => sum + row.total, 0);

  return (
    <AdminPage
      title="Rep directory"
      description="Every rep each system knows, in one searchable place. SAP and Pine are read from their own rep tables; Leverage, DataEdge and EABL DMS have none, so their reps come from the sales, visit and call rows already stored."
      stats={[
        { label: "identities", value: totalIdentities.toLocaleString() },
        { label: "showing", value: overview.shown.toLocaleString() },
      ]}
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {overview.bySource.map((row) => (
          <AdminCard key={row.source} eyebrow={row.source === "SAP" || row.source === "PINE" ? "Own rep table" : "Derived from stored rows"} title={REP_SOURCE_LABELS[row.source]}>
            <p className="text-2xl font-bold text-brand-navy">{row.active.toLocaleString()} <span className="text-xs font-normal text-muted">active of {row.total.toLocaleString()}</span></p>
            {row.source === "SAP" || row.source === "PINE" ? (
              <p className="mt-1 text-xs text-muted">
                {row.offRoster > 0 ? <Link href={href(params, { source: row.source, roster: "off", status: "active", field: "1" })} className="font-semibold text-secondary-blue hover:underline">{row.offRoster.toLocaleString()} active field reps not on the roster</Link> : "Every active field rep is on the roster."}
              </p>
            ) : (
              <p className="mt-1 text-xs text-muted">Match each rep to a roster employee in the last column.</p>
            )}
            <p className="mt-1 text-[11px] text-muted">Last synced {whenTime(row.lastSeenAt)}</p>
            <div className="mt-2"><RefreshSyncButton job={SOURCE_JOBS[row.source]} label={SYNC_JOB_INFO[SOURCE_JOBS[row.source]].label} /></div>
          </AdminCard>
        ))}
      </div>

      <AdminCard flush title="Search the directory" description="By name, code, login, sales group or principal. Names ignore case, punctuation and spacing.">
        <form method="get" className="flex flex-wrap items-end gap-3 px-5 pb-4 pt-3">
          <label className="min-w-[14rem] flex-1 text-xs font-semibold text-muted">Search
            <input name="q" defaultValue={params.q ?? ""} placeholder="e.g. macharia, 1249, TDR, EFL" className={`${inputClass} mt-1 block w-full`} />
          </label>
          <label className="text-xs font-semibold text-muted">Source
            <select name="source" defaultValue={params.source ?? ""} className={`${inputClass} mt-1 block`}>
              <option value="">All sources</option>
              {REP_SOURCES.map((source) => <option key={source} value={source}>{REP_SOURCE_LABELS[source]}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold text-muted">Status
            <select name="status" defaultValue={status} className={`${inputClass} mt-1 block`}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="all">Both</option>
            </select>
          </label>
          <label className="text-xs font-semibold text-muted">Roster
            <select name="roster" defaultValue={params.roster ?? ""} className={`${inputClass} mt-1 block`}>
              <option value="">Either</option>
              <option value="on">On the roster</option>
              <option value="off">Not on the roster</option>
            </select>
          </label>
          <label className="flex items-center gap-2 pb-2 text-xs font-semibold text-muted">
            <input type="checkbox" name="field" value="1" defaultChecked={params.field === "1"} /> Field reps only
          </label>
          <button type="submit" className="rounded-full bg-primary-blue px-4 py-2 text-xs font-semibold text-white hover:opacity-90">Search</button>
          {filtersActive ? <Link href="/admin/rep-directory" className="pb-2 text-xs text-secondary-blue underline">Clear</Link> : null}
        </form>

        <div className="overflow-x-auto border-t border-border/60">
          <table className={adminTable.table}>
            <thead className={adminTable.head}>
              <tr>
                <th className={adminTable.th}>Name</th>
                <th className={adminTable.th}>Source</th>
                <th className={adminTable.th}>Code / key</th>
                <th className={adminTable.th}>Group · region · branch</th>
                <th className={adminTable.th}>Last activity</th>
                <th className={adminTable.th}>Status</th>
                <th className={adminTable.th}>On the roster as</th>
              </tr>
            </thead>
            <tbody>
              {overview.rows.length === 0 ? (
                <tr><td colSpan={7} className={adminTable.empty}>{totalIdentities === 0 ? "The directory is empty until the first sync runs after the deploy. Use Refresh now on a card above." : "No rep matches these filters."}</td></tr>
              ) : overview.rows.map((row) => (
                <tr key={row.id}>
                  <td className={adminTable.td}>
                    <p className="font-semibold text-brand-navy">{row.displayName}</p>
                    {row.loginName ? <p className="text-[11px] text-muted">login {row.loginName}</p> : null}
                  </td>
                  <td className={adminTable.td}>{REP_SOURCE_LABELS[row.source]}<p className="text-[11px] text-muted">{row.origin === "TABLE" ? "rep table" : "from sales rows"}</p></td>
                  <td className={`${adminTable.td} font-mono text-xs`}>{row.sourceKey}</td>
                  <td className={adminTable.td}>
                    {[row.groupLabel, row.region, row.branch, row.principalHint].filter(Boolean).join(" · ") || <span className="text-muted">-</span>}
                  </td>
                  <td className={adminTable.td}>{when(row.lastActivityAt)}</td>
                  <td className={adminTable.td}>
                    <div className="flex flex-wrap gap-1">
                      <AdminBadge tone={row.isActive ? "good" : "default"}>{row.isActive ? "Active" : "Inactive"}</AdminBadge>
                      {!row.isFieldRep ? <AdminBadge>Not a field rep</AdminBadge> : null}
                    </div>
                  </td>
                  <td className={adminTable.td}>
                    {row.source === "SAP" || row.source === "PINE" ? (
                      row.roster.length === 0 ? (
                        <span className="text-xs text-muted">Not on the roster</span>
                      ) : (
                        <div className="space-y-0.5">
                          {row.roster.map((match) => (
                            <p key={match.employeeCode} className="text-xs">
                              <Link href={`/admin/employee-master?q=${encodeURIComponent(match.employeeCode)}`} className="font-semibold text-secondary-blue hover:underline">{match.name}</Link>
                              <span className="text-muted"> ({match.employeeCode}){match.active ? "" : " · inactive"}</span>
                              {match.linked ? null : <span className="ml-1 text-[10px] text-accent-amber">name only</span>}
                            </p>
                          ))}
                          {row.roster.length > 1 ? <AdminBadge tone="attention">Shared by {row.roster.length}</AdminBadge> : null}
                        </div>
                      )
                    ) : (
                      <RosterLinkPicker source={row.source} sourceKey={row.sourceKey} identityName={row.displayName} initialLinked={row.roster.filter((m) => m.linked).map((m) => ({ employeeCode: m.employeeCode, name: m.name }))} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {overview.matchedTotal > REP_DIRECTORY_PAGE_SIZE ? (
          <p className="border-t border-border/60 px-5 py-3 text-xs text-muted">Showing the first {REP_DIRECTORY_PAGE_SIZE} of {overview.matchedTotal.toLocaleString()} matches. Narrow the search to see the rest.</p>
        ) : null}
      </AdminCard>
    </AdminPage>
  );
}
