import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { canonicalTeamLeaderIdMap } from "@/lib/tlRanking";
import { AdminBadge, AdminCard, AdminDisclosure, AdminNotices, AdminPage, adminTable, searchText } from "@/components/admin/AdminPage";
import { checkPrincipalSalesMapping, type PrincipalMappingIssue } from "@/lib/principalSalesMapping";
import { AdminTableSearch } from "@/components/admin/AdminTableSearch";
import { createPrincipalAction, updatePrincipalAction, deletePrincipalAction } from "./actions";

export const dynamic = "force-dynamic";

const inputClass =
  "rounded-full border border-border bg-surface px-4 py-2 text-sm text-foreground outline-none focus:border-secondary-blue";
const selectClass = inputClass;
const labelClass = "text-[13px] font-medium text-muted-strong";

export default async function AdminPrincipalsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; edit?: string }>;
}) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    redirect("/");
  }

  const { error, success, edit } = await searchParams;
  const [principals, allTeamLeaders, supervisors, managers, hods, activeAssignments] = await Promise.all([
    prisma.principal.findMany({ orderBy: { principal: "asc" } }),
    prisma.teamLeader.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, supervisorId: true } }),
    prisma.supervisor.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, managerId: true } }),
    prisma.manager.findMany({ select: { id: true, hodId: true } }),
    prisma.hod.findMany({ select: { id: true, name: true } }),
    // The real, multi-Team-Leader roster (distinct from Principal.teamLeaderId's
    // single ranking-credit field below) — live count/list per principal, so a
    // principal like Mars-Nairobi correctly shows every Team Leader actually
    // working it instead of just the one credited for TL Ranking.
    prisma.teamLeaderAssignment.findMany({ where: { active: true }, select: { principal: true, teamLeaderId: true } }),
  ]);
  // Why an Active principal might show no SAP sales (lib/principalSalesMapping.ts): its Product Master
  // mapping, the "-<Location>" name the sales sync matches, and unidentified SAP items that look like it.
  const [mappingProducts, unmappedSales, salesPrincipals] = await Promise.all([
    prisma.product.findMany({ select: { itemNo: true, principal: true } }),
    prisma.unmappedProductSale.groupBy({ by: ["itemNo", "itemDescription"], _sum: { revenue: true } }),
    prisma.salesRecord.findMany({ distinct: ["principal"], select: { principal: true } }),
  ]);
  const salesMapping = checkPrincipalSalesMapping({
    principals: principals.map((p) => ({ principal: p.principal, location: p.location, status: p.status })),
    products: mappingProducts,
    unmapped: unmappedSales.map((row) => ({ itemNo: row.itemNo, itemDescription: row.itemDescription, revenue: row._sum.revenue ?? 0 })),
    principalsWithSales: new Set(salesPrincipals.map((row) => row.principal)),
  });
  const mappingProblems = salesMapping.principals.filter((row) => row.issues.length > 0);
  const mappingIssueCount = mappingProblems.length + salesMapping.orphanProductPrincipals.length;
  const canonicalTeamLeaderIds = canonicalTeamLeaderIdMap(allTeamLeaders, supervisors);
  const teamLeaders = allTeamLeaders.filter((teamLeader) => canonicalTeamLeaderIds.get(teamLeader.id) === teamLeader.id);
  const teamLeaderNameById = new Map(teamLeaders.map((tl) => [tl.id, tl.name]));
  const supervisorNameById = new Map(supervisors.map((s) => [s.id, s.name]));
  const hodNameById = new Map(hods.map((h) => [h.id, h.name]));
  const hodIdByManagerId = new Map(managers.map((m) => [m.id, m.hodId]));
  const headOfSalesNameBySupervisorId = new Map(
    supervisors.map((s) => {
      const hodId = s.managerId ? hodIdByManagerId.get(s.managerId) : null;
      return [s.id, hodId ? hodNameById.get(hodId) ?? null : null];
    })
  );
  const rosterByPrincipal = new Map<string, Set<string>>();
  for (const a of activeAssignments) {
    const set = rosterByPrincipal.get(a.principal) ?? new Set<string>();
    set.add(a.teamLeaderId);
    rosterByPrincipal.set(a.principal, set);
  }
  const editing = edit ? principals.find((p) => p.id === edit) : undefined;
  const activeCount = principals.filter((p) => p.status === "Active").length;
  const dormantCount = principals.filter((p) => p.stockDormant).length;
  const unownedCount = principals.filter((p) => !p.teamLeaderId).length;

  return (
    <AdminPage
      title="Principals"
      description="Principal → location reference data used by the SQL bridge, with its ranking credit, Supervisor and dormant-stock flags."
      stats={[
        { label: "principals", value: principals.length },
        { label: "active", value: activeCount },
        ...(dormantCount > 0 ? [{ label: "dormant stock", value: dormantCount }] : []),
        ...(unownedCount > 0 ? [{ label: "without a ranking Team Leader", value: unownedCount, tone: "attention" as const }] : []),
      ]}
    >
      <AdminNotices error={error} success={success} />

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
        <div className="rounded-xl border-l-4 border-l-accent-amber bg-surface px-4 py-3 text-sm text-muted-strong shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
          <strong className="text-accent-amber">&quot;Team Leader (ranking)&quot; and Supervisor below grant no dashboard access.</strong>{" "}
          They only credit MTD revenue to one person for TL Ranking. To actually give a Team Leader or Supervisor visibility into
          a Principal&apos;s data — including its reps — assign it on{" "}
          <Link href="/admin/team-leaders" className="text-primary-blue hover:underline">
            Team Leaders
          </Link>{" "}
          (&quot;Assign a Principal to a Team Leader&quot;) instead.
        </div>

        <AdminDisclosure tone="note" title="How these columns work">
          <p className="text-[13px] leading-relaxed text-muted-strong">
            Principal → location reference data used by the SQL bridge. &quot;Team Leader (ranking)&quot; credits 100% of that principal&apos;s MTD revenue to one
          Team Leader for TL Ranking — it is not the real roster. &quot;Roster&quot; shows every Team Leader actually working that principal today (from{" "}
          <Link href="/admin/team-leaders" className="text-primary-blue hover:underline">
            Team Leaders
          </Link>
          ). Supervisor is independently settable — for a principal a Supervisor manages directly, with no Team Leader recorded — and defaults to the
          ranking Team Leader&apos;s own Supervisor when left blank; Head of Sales is always derived from it. &quot;Dormant stock&quot; marks a stopped principal that
          still holds stock (optionally with the date it stopped, which shows as its dormancy period in the extract): its stock is left out of the Stock Balance (and listed under Dormant Stock) even while it still shows sales, and the Stock
          Balance extract marks it Inactive. It is separate from Status, which also decides whether a principal&apos;s sales are counted.
        </p>
        </AdminDisclosure>
      </div>

      {mappingIssueCount > 0 ? (
        <AdminDisclosure
          defaultOpen
          title="SAP sales mapping check"
          badge={<AdminBadge tone="attention">{mappingIssueCount} to fix</AdminBadge>}
          description="A SAP sale reaches a principal only when its item is in the Product Master under that principal's exact name, and “Name-Location” matches an Active row here. Otherwise it is skipped."
        >
          <ul className="flex max-h-[420px] flex-col divide-y divide-border/60 overflow-y-auto text-sm">
            {mappingProblems.map((row) => (
              <li key={row.principal} className="flex flex-wrap items-start justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="font-semibold text-brand-navy">
                    {row.principal}{" "}
                    <span className={`ml-1 text-xs font-medium ${row.hasSales ? "text-accent-green" : "text-accent-red"}`}>{row.hasSales ? "has SAP sales" : "no SAP sales yet"}</span>
                  </p>
                  <ul className="mt-1 flex flex-col gap-0.5 text-[13px] text-muted-strong">
                    {row.issues.map((issue, index) => (
                      <li key={index}>{mappingIssueText(issue, row.productName)}</li>
                    ))}
                  </ul>
                </div>
                {row.issues.some((issue) => issue.kind === "unmapped-items" || issue.kind === "no-products") ? (
                  <Link href="/admin/products" className="shrink-0 rounded-full border border-secondary-blue/30 bg-surface px-3 py-1.5 text-xs font-semibold text-primary-blue hover:bg-accent-blue-soft">
                    Map items on Product master →
                  </Link>
                ) : null}
              </li>
            ))}
            {salesMapping.orphanProductPrincipals.map((orphan) => (
              <li key={orphan.productPrincipal} className="flex flex-wrap items-start justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="font-semibold text-brand-navy">Product Master principal “{orphan.productPrincipal}”</p>
                  <p className="mt-1 text-[13px] text-muted-strong">
                    {orphan.productCount} item{orphan.productCount === 1 ? " is" : "s are"} mapped to it, but no principal row is named “{orphan.productPrincipal}-&lt;Location&gt;”, so their sales are skipped.
                    {orphan.closestPrincipal ? ` Did you mean ${orphan.closestPrincipal}? The spelling must match exactly.` : " Add the principal below, or remap the items."}
                  </p>
                </div>
                <Link href={`/admin/products?q=${encodeURIComponent(orphan.productPrincipal)}`} className="shrink-0 rounded-full border border-secondary-blue/30 bg-surface px-3 py-1.5 text-xs font-semibold text-primary-blue hover:bg-accent-blue-soft">
                  Show its items →
                </Link>
              </li>
            ))}
          </ul>
        </AdminDisclosure>
      ) : null}

      <AdminDisclosure title="Add a principal" description="A new principal reference row: location, status, dormant stock and ranking credit.">
        <form action={createPrincipalAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-2">
            <label className={labelClass}>Principal (exact, e.g. &quot;EABL-Nyeri&quot;)</label>
            <input name="principal" required className={inputClass} />
          </div>
          <div className="flex flex-col gap-2">
            <label className={labelClass}>Main principal</label>
            <input name="mainPrincipal" className={inputClass} />
          </div>
          <div className="flex flex-col gap-2">
            <label className={labelClass}>Location</label>
            <input name="location" className={inputClass} />
          </div>
          <div className="flex flex-col gap-2">
            <label className={labelClass}>Location code</label>
            <input name="locationCode" className={inputClass} />
          </div>
          <div className="flex flex-col gap-2">
            <label className={labelClass}>Status</label>
            <select name="status" defaultValue="Active" className={selectClass}>
              <option value="Active">Active</option>
              <option value="Past">Past</option>
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <label className={labelClass}>Dormant stock</label>
            <label className="flex items-center gap-2 py-2 text-sm text-foreground">
              <input type="checkbox" name="stockDormant" className="h-4 w-4" />
              Stopped principal still holding stock
            </label>
            <label className={labelClass}>Dormant since (optional)</label>
            <input type="date" name="stockDormantSince" className={inputClass} />
          </div>
          <div className="flex flex-col gap-2">
            <label className={labelClass}>Team Leader (credited for TL Ranking)</label>
            <select name="teamLeaderId" defaultValue="" className={selectClass}>
              <option value="">— none —</option>
              {teamLeaders.map((tl) => (
                <option key={tl.id} value={tl.id}>
                  {tl.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <label className={labelClass}>Supervisor</label>
            <select name="supervisorId" defaultValue="" className={selectClass}>
              <option value="">— derive from Team Leader, if any —</option>
              {supervisors.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2 lg:col-span-4">
            <button
              type="submit"
              className="rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-5 py-2.5 text-sm font-semibold text-white transition-all duration-300 hover:shadow-cyan-glow"
            >
              Add principal
            </button>
          </div>
        </form>
      </AdminDisclosure>

      <AdminCard
        flush
        title={`Principals (${principals.length})`}
        actions={<AdminTableSearch target="principals" placeholder="Search principal, location, Supervisor or Team Leader" />}
      >
        <div className="overflow-x-auto" data-filter-root="principals">
          <table className={adminTable.table}>
            <thead className={adminTable.head}>
              <tr>
                <th className={adminTable.th}>Principal</th>
                <th className={adminTable.th}>Main principal</th>
                <th className={adminTable.th}>Location</th>
                <th className={adminTable.th}>Status</th>
                <th className={adminTable.th}>Stock</th>
                <th className={adminTable.th}>Supervisor</th>
                <th className={adminTable.th}>Head of Sales</th>
                <th className={adminTable.th}>Team Leader (ranking)</th>
                <th className={adminTable.th}>Roster</th>
                <th className={adminTable.thRight}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {principals.map((p) =>
                editing?.id === p.id ? (
                  <tr key={p.id} className="bg-accent-blue-soft/40">
                    <td colSpan={10} className="border-b border-border/60 px-4 py-4">
                      <form action={updatePrincipalAction} className="grid grid-cols-1 sm:grid-cols-6 gap-3 items-end">
                        <input type="hidden" name="principalId" value={p.id} />
                        <div className="flex flex-col gap-1">
                          <label className={labelClass}>Principal</label>
                          <input value={p.principal} disabled className={inputClass + " opacity-60"} />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className={labelClass}>Main principal</label>
                          <input name="mainPrincipal" defaultValue={p.mainPrincipal} className={inputClass} />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className={labelClass}>Location</label>
                          <input name="location" defaultValue={p.location} className={inputClass} />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className={labelClass}>Status</label>
                          <select name="status" defaultValue={p.status} className={selectClass}>
                            <option value="Active">Active</option>
                            <option value="Past">Past</option>
                          </select>
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className={labelClass}>Dormant stock</label>
                          <label className="flex items-center gap-2 py-2 text-sm text-foreground">
                            <input type="checkbox" name="stockDormant" defaultChecked={p.stockDormant} className="h-4 w-4" />
                            Stopped, still holds stock
                          </label>
                          <input type="date" name="stockDormantSince" defaultValue={p.stockDormantSince ? p.stockDormantSince.toISOString().slice(0, 10) : ""} className={inputClass} aria-label="Dormant since" />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className={labelClass}>Supervisor</label>
                          <select name="supervisorId" defaultValue={p.supervisorId ?? ""} className={selectClass}>
                            <option value="">— derive from Team Leader, if any —</option>
                            {supervisors.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className={labelClass}>Team Leader (ranking)</label>
                          <select name="teamLeaderId" defaultValue={p.teamLeaderId ?? ""} className={selectClass}>
                            <option value="">— none —</option>
                            {teamLeaders.map((tl) => (
                              <option key={tl.id} value={tl.id}>
                                {tl.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="flex gap-2 sm:col-span-6">
                          <button type="submit" className="rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-4 py-2 text-xs font-semibold text-white">
                            Save
                          </button>
                          <Link href="/admin/principals" className="rounded-full px-4 py-2 text-xs font-medium text-muted-strong hover:bg-background-elevated">
                            Cancel
                          </Link>
                        </div>
                      </form>
                    </td>
                  </tr>
                ) : (
                  <tr
                    key={p.id}
                    data-search={searchText(
                      p.principal,
                      p.mainPrincipal,
                      p.location,
                      p.status,
                      p.stockDormant ? "dormant" : null,
                      p.supervisorId ? supervisorNameById.get(p.supervisorId) : null,
                      p.supervisorId ? headOfSalesNameBySupervisorId.get(p.supervisorId) : null,
                      p.teamLeaderId ? teamLeaderNameById.get(p.teamLeaderId) : "unowned"
                    )}
                  >
                    <td className={`${adminTable.td} font-medium`}>{p.principal}</td>
                    <td className={adminTable.td}>{p.mainPrincipal}</td>
                    <td className={adminTable.td}>{p.location}</td>
                    <td className={adminTable.td}>{p.status}</td>
                    <td className={adminTable.td}>
                      {p.stockDormant ? <span className="rounded-full bg-accent-amber-soft px-2.5 py-0.5 text-xs font-semibold text-accent-amber">Dormant stock{p.stockDormantSince ? ` since ${p.stockDormantSince.toISOString().slice(0, 10)}` : ""}</span> : <span className="text-muted">Active</span>}
                    </td>
                    <td className={adminTable.td}>
                      {p.supervisorId ? supervisorNameById.get(p.supervisorId) ?? "—" : <span className="text-muted">—</span>}
                    </td>
                    <td className={adminTable.td}>
                      {p.supervisorId ? headOfSalesNameBySupervisorId.get(p.supervisorId) ?? <span className="text-muted">—</span> : <span className="text-muted">—</span>}
                    </td>
                    <td className={adminTable.td}>
                      {p.teamLeaderId ? teamLeaderNameById.get(p.teamLeaderId) ?? "—" : <span className="text-accent-amber">Unowned</span>}
                    </td>
                    <td className={adminTable.td}>
                      {(() => {
                        const roster = rosterByPrincipal.get(p.principal);
                        if (!roster || roster.size === 0) return <span className="text-muted">No active reps</span>;
                        const names = Array.from(roster).map((id) => teamLeaderNameById.get(id) ?? id).sort();
                        return (
                          <Link
                            href={`/admin/team-leaders?filterPrincipal=${encodeURIComponent(p.principal)}#assignments`}
                            title={names.join(", ")}
                            className="text-primary-blue hover:underline"
                          >
                            {roster.size} Team Leader{roster.size === 1 ? "" : "s"} →
                          </Link>
                        );
                      })()}
                    </td>
                    <td className={`${adminTable.tdRight} whitespace-nowrap`}>
                      <Link href={`/admin/principals?edit=${p.id}`} className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium text-primary-blue hover:bg-accent-blue-soft transition-colors duration-300">
                        Edit
                      </Link>
                      <form action={deletePrincipalAction} className="inline">
                        <input type="hidden" name="principalId" value={p.id} />
                        <button type="submit" className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium text-accent-red hover:bg-accent-red-soft transition-colors duration-300">
                          Remove
                        </button>
                      </form>
                    </td>
                  </tr>
                )
              )}
              {principals.length === 0 ? (
                <tr>
                  <td colSpan={10} className={adminTable.empty}>
                    No principals yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </AdminCard>
    </AdminPage>
  );
}

function mappingIssueText(issue: PrincipalMappingIssue, productName: string | null): string {
  switch (issue.kind) {
    case "missing-location":
      return `The name has no location, so no SAP sale can match it. SAP sales are matched as “Name-Location”: rename it to ${issue.expectedExample}.`;
    case "no-products":
      return `No Product Master items are mapped to “${productName}”, so its SAP sales are skipped.`;
    case "name-mismatch":
      return `${issue.productCount} item${issue.productCount === 1 ? " is" : "s are"} mapped as “${issue.productPrincipal}”, which differs from “${productName}” only in case or punctuation. The spelling must match exactly.`;
    case "unmapped-items":
      return `${issue.itemCount} unidentified SAP item${issue.itemCount === 1 ? "" : "s"} (KES ${Math.round(issue.revenue).toLocaleString("en-KE")}) look like this principal by item code, e.g. ${issue.examples.join(", ")}: map them on Product master.`;
  }
}
