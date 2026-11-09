// Reads what an admin has approved from the cleanup tables (for the compile in rebuild.ts) and marks it applied once a compile has used it.
import { prisma } from "@/lib/db";
import type { ApprovedCleanup, ApprovedEntry } from "./overlay";
import type { RepDecision } from "./types";

/** What an admin has approved and the compile must apply: validated and applied entries and duplicate calls, and the marked-open outlets a team claimed or the admin closed. */
export async function loadApprovedCleanup(): Promise<ApprovedCleanup> {
  const [entries, duplicates, open] = await Promise.all([
    prisma.outletCleanupEntry.findMany({ where: { status: { in: ["VALIDATED", "APPLIED"] } } }),
    prisma.outletDuplicateDecision.findMany({ where: { status: { in: ["VALIDATED", "APPLIED"] } } }),
    prisma.markedOpenOutlet.findMany({ where: { status: { in: ["CLAIMED", "CLOSED"] } }, orderBy: { markedAt: "asc" } }),
  ]);
  const approvedEntries: ApprovedEntry[] = entries.map((e) => ({
    id: e.id,
    source: e.source,
    outletKey: e.outletKey,
    region: e.region,
    territory: e.territory,
    channel: e.channel,
    customerType: e.customerType,
    contactName: e.contactName,
    contactPhone: e.contactPhone,
    latitude: e.latitude,
    longitude: e.longitude,
    repDecisions: Array.isArray(e.repDecisions) ? (e.repDecisions as unknown as RepDecision[]) : [],
  }));
  const codes = [...new Set(approvedEntries.flatMap((e) => e.repDecisions.filter((d) => d.action === "CHANGED" && d.repCode).map((d) => d.repCode as string)))];
  const repTeamLeader = new Map<string, string>();
  if (codes.length > 0) {
    const [employees, leaders] = await Promise.all([
      prisma.employeeMaster.findMany({ where: { employeeCode: { in: codes } }, select: { employeeCode: true, teamLeader: true, teamLeaderId: true } }),
      prisma.teamLeader.findMany({ select: { id: true, name: true } }),
    ]);
    const leaderName = new Map(leaders.map((l) => [l.id, l.name]));
    for (const e of employees) {
      const name = (e.teamLeaderId ? leaderName.get(e.teamLeaderId) : null) ?? e.teamLeader;
      if (name) repTeamLeader.set(e.employeeCode, name);
    }
  }
  return {
    entries: approvedEntries,
    duplicates: duplicates.map((d) => ({ id: d.id, aSource: d.aSource, aKey: d.aKey, bSource: d.bSource, bKey: d.bKey, decision: d.decision as "MERGE" | "NOT_DUPLICATE" })),
    open: open.map((o) => ({ source: o.source, outletKey: o.outletKey, previousTeamLeader: o.previousTeamLeader, status: o.status as "CLAIMED" | "CLOSED", claimedBy: o.claimedBy })),
    repTeamLeader,
  };
}

/** After a compile that applied them, the validated entries and duplicate calls become APPLIED. */
export async function markApplied(approved: ApprovedCleanup): Promise<void> {
  const now = new Date();
  if (approved.entries.length > 0) await prisma.outletCleanupEntry.updateMany({ where: { id: { in: approved.entries.map((e) => e.id) }, status: "VALIDATED" }, data: { status: "APPLIED", appliedAt: now } });
  if (approved.duplicates.length > 0) await prisma.outletDuplicateDecision.updateMany({ where: { id: { in: approved.duplicates.map((d) => d.id) }, status: "VALIDATED" }, data: { status: "APPLIED" } });
}
