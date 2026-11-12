import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { AdminBadge, AdminCard, AdminNotices, AdminPage, adminTable } from "@/components/admin/AdminPage";
import { ConfirmSubmitButton } from "@/components/ui/ConfirmSubmitButton";
import { getBulkProposals, getRosterActor, proposalToken } from "@/lib/repLinks";
import { REP_SOURCE_LABELS } from "@/lib/repDirectoryBuild";
import { acceptLinkProposalsAction } from "./actions";

export const dynamic = "force-dynamic";

type SearchParams = { success?: string; error?: string };

export default async function RosterLinkReviewPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const actor = await getRosterActor();
  if (!actor) redirect("/");
  const params = await searchParams;

  const [{ proposals, conflicts }, linkCounts, activeEmployees, changes] = await Promise.all([
    getBulkProposals(actor),
    prisma.employeeRepLink.groupBy({ by: ["source"], where: { source: { in: ["SAP", "PINE"] }, employee: { active: true } }, _count: { _all: true } }),
    prisma.employeeMaster.count({ where: { active: true } }),
    actor.isAdmin ? prisma.employeeRepLinkChange.findMany({ orderBy: { changedAt: "desc" }, take: 25 }) : Promise.resolve([]),
  ]);
  const linked = (source: string) => linkCounts.find((row) => row.source === source)?._count._all ?? 0;

  return (
    <AdminPage
      title="Review rep links"
      description="Exact name matches between the roster and the rep directory, ready to accept together, and the ones a person has to decide. Nothing is linked until you accept it."
      back={{ href: "/admin/employee-master", label: "Back to the roster" }}
      stats={[
        { label: "ready to accept", value: proposals.length },
        { label: "need a decision", value: conflicts.length, tone: conflicts.length > 0 ? "attention" : "default" },
        { label: "SAP linked", value: `${linked("SAP")} of ${activeEmployees}` },
        { label: "Pine linked", value: `${linked("PINE")} of ${activeEmployees}` },
      ]}
    >
      <AdminNotices error={params.error} success={params.success} />

      <AdminCard
        flush
        title={<>Exact matches ready to accept <AdminBadge tone={proposals.length > 0 ? "good" : "default"}>{proposals.length}</AdminBadge></>}
        description="Each row's name equals one directory identity that nobody else holds (a Pine user id that equals the roster code counts too). Accepting also writes the directory's exact spelling and code to the employee."
        actions={
          proposals.length > 0 ? (
            <form action={acceptLinkProposalsAction}>
              {proposals.map((p) => (
                <input key={proposalToken(p)} type="hidden" name="token" value={proposalToken(p)} />
              ))}
              <ConfirmSubmitButton
                confirmMessage={`Link all ${proposals.length} rows listed below? Each is checked again first, and every change is logged.`}
                className="rounded-full bg-primary-blue px-4 py-2 text-xs font-semibold text-white hover:bg-secondary-blue"
              >
                Accept all {proposals.length}
              </ConfirmSubmitButton>
            </form>
          ) : undefined
        }
      >
        <div className="overflow-x-auto">
          <table className={adminTable.table}>
            <thead className={adminTable.head}>
              <tr>
                <th className={adminTable.th}>Roster employee</th>
                <th className={adminTable.th}>Column</th>
                <th className={adminTable.th}>Matches</th>
                <th className={adminTable.th}>Because</th>
                <th className={adminTable.thRight}>Accept</th>
              </tr>
            </thead>
            <tbody>
              {proposals.length === 0 ? (
                <tr><td colSpan={5} className={adminTable.empty}>No exact matches are waiting. Use the roster&apos;s columns to link the rest by hand.</td></tr>
              ) : (
                proposals.map((p) => (
                  <tr key={proposalToken(p)}>
                    <td className={adminTable.td}>
                      <Link href={`/admin/employee-master?q=${encodeURIComponent(p.employeeCode)}`} className="font-semibold text-secondary-blue hover:underline">{p.employeeName}</Link>{" "}
                      <span className="text-xs text-muted">({p.employeeCode})</span>
                    </td>
                    <td className={adminTable.td}>{p.source === "SAP" ? "SAP rep" : "SFA (Pine) rep"}</td>
                    <td className={adminTable.td}>
                      {p.identityName} <span className="font-mono text-[11px] text-muted">{p.source === "SAP" ? "SlpCode" : "Pine ID"} {p.sourceKey}</span>
                    </td>
                    <td className={adminTable.td}>{p.basis === "code" ? "Pine ID equals the roster code" : "Same name"}</td>
                    <td className={adminTable.tdRight}>
                      <form action={acceptLinkProposalsAction}>
                        <input type="hidden" name="token" value={proposalToken(p)} />
                        <button type="submit" className="rounded-full px-3 py-1.5 text-xs font-semibold text-primary-blue hover:bg-accent-blue-soft">Accept</button>
                      </form>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </AdminCard>

      <AdminCard
        flush
        title={<>Needs a decision <AdminBadge tone={conflicts.length > 0 ? "attention" : "default"}>{conflicts.length}</AdminBadge></>}
        description="The name matches an identity that another roster employee already holds, or that two employees both match. One person with two roster codes is fine: open the roster row and link it on purpose. A mistaken duplicate is better deleted or deactivated."
      >
        <div className="overflow-x-auto">
          <table className={adminTable.table}>
            <thead className={adminTable.head}>
              <tr>
                <th className={adminTable.th}>Roster employee</th>
                <th className={adminTable.th}>Column</th>
                <th className={adminTable.th}>Matches</th>
                <th className={adminTable.th}>Also held by</th>
              </tr>
            </thead>
            <tbody>
              {conflicts.length === 0 ? (
                <tr><td colSpan={4} className={adminTable.empty}>Nothing to decide.</td></tr>
              ) : (
                conflicts.map((c) => (
                  <tr key={proposalToken(c)}>
                    <td className={adminTable.td}>
                      <Link href={`/admin/employee-master?q=${encodeURIComponent(c.employeeCode)}`} className="font-semibold text-secondary-blue hover:underline">{c.employeeName}</Link>{" "}
                      <span className="text-xs text-muted">({c.employeeCode})</span>
                    </td>
                    <td className={adminTable.td}>{c.source === "SAP" ? "SAP rep" : "SFA (Pine) rep"}</td>
                    <td className={adminTable.td}>{c.identityName} <span className="font-mono text-[11px] text-muted">{c.sourceKey}</span></td>
                    <td className={adminTable.td}>{c.heldBy.map((h) => `${h.name} (${h.employeeCode})`).join(", ")}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </AdminCard>

      {actor.isAdmin ? (
        <AdminCard flush title="Recent link changes" description="The last 25 changes, so a wrong click can be seen and put back from the roster.">
          <div className="overflow-x-auto">
            <table className={adminTable.table}>
              <thead className={adminTable.head}>
                <tr>
                  <th className={adminTable.th}>When</th>
                  <th className={adminTable.th}>Who</th>
                  <th className={adminTable.th}>Employee</th>
                  <th className={adminTable.th}>Column</th>
                  <th className={adminTable.th}>Change</th>
                </tr>
              </thead>
              <tbody>
                {changes.length === 0 ? (
                  <tr><td colSpan={5} className={adminTable.empty}>No links have been changed yet.</td></tr>
                ) : (
                  changes.map((c) => (
                    <tr key={c.id}>
                      <td className={adminTable.td}>{c.changedAt.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</td>
                      <td className={adminTable.td}>{c.changedBy ?? "unknown"}</td>
                      <td className={`${adminTable.td} font-mono text-xs`}>{c.employeeCode}</td>
                      <td className={adminTable.td}>{REP_SOURCE_LABELS[c.source as keyof typeof REP_SOURCE_LABELS] ?? c.source}</td>
                      <td className={adminTable.td}>
                        <AdminBadge>{c.action === "UNLINK" ? "Removed" : c.action === "RELINK" ? "Changed" : c.action === "ACCEPT_PROPOSAL" ? "Accepted" : "Linked"}</AdminBadge>{" "}
                        <span className="text-xs">{c.fromName ? `${c.fromName} → ` : ""}{c.toName ?? (c.action === "UNLINK" ? "no link" : "")}</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </AdminCard>
      ) : null}
    </AdminPage>
  );
}
