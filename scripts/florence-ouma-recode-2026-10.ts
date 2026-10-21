// One-off (21 Oct 2026): Florence Ouma was reissued a new employee code, 1221, replacing 1114. She is
// otherwise unchanged — still under Team Leader Eva Gachoki, selling EFL-Nairobi and Milly Fruits-Nairobi
// (the Milly Fruits row was itself created for her under 1114 by scripts/eva-visibility-2026-10.ts).
//
// Handles both of the two ways 1221 can exist when this runs:
//   - 1221 has no EmployeeMaster row yet: 1114's own row is renamed in place (same id, so its
//     EmployeePrincipalContribution rows carry over automatically via the employeeId relation).
//   - 1221 already has its own EmployeeMaster row (e.g. surfaced on the "Unresolved rep identities"
//     worklist from a newer Roster import that doesn't resolve a Team Leader on its own): 1114's
//     roster fields and contributions are copied onto it — never overwriting a field 1221 already
//     has its own value for — and 1114's row is deleted once nothing still points at it.
// Either way, every TeamLeaderAssignment row still under 1114 (not just the two known ones, in case
// she carries other history) is re-keyed to 1221. A principal where 1221 already holds a row of its
// own (the same duplicate-identity situation, not a genuine second assignment) is folded the same way
// scripts/org-restructure-2026-10.ts's clearMergeConflicts folds a Team Leader merge's duplicates: any
// reference field 1221's row is missing is filled from 1114's, 1114's row is then removed, and only a
// real conflict — both sides declaring a different non-zero contributionPct — is left alone and
// reported for a person to resolve, same as lib/rosterMerge.ts's own conflict handling.
//
//   node --import tsx scripts/florence-ouma-recode-2026-10.ts            DRY RUN: does everything, prints it, rolls it all back
//   node --import tsx scripts/florence-ouma-recode-2026-10.ts --apply    the same, committed (then recomputes rep contribution and daily targets)
//
// Run it on the 1 GB sap-sync-worker container. One transaction; idempotent (a second run finds the work done).
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/db";
import { recomputeRosterDerived } from "../lib/rosterAssignment";

const apply = process.argv.includes("--apply");
class DryRunRollback extends Error {}
const log = (message: string) => console.log(message);

const OLD_CODE = "1114";
const NEW_CODE = "1221";
const TEAM_LEADER = "Eva Gachoki";
const EXPECTED_PRINCIPALS = ["EFL-Nairobi", "Milly Fruits-Nairobi"];
const AUDIT_USER = "system: florence ouma recode 2026-10-21";

const ROSTER_FIELDS = [
  "teamLeader",
  "supervisor",
  "teamLeaderId",
  "supervisorId",
  "absolutePrincipal",
  "salesRole",
  "workGroup",
  "region",
  "subRegion",
  "costCenterCount",
  "salesPoint",
  "route",
  "location",
  "company",
] as const;

// TeamLeaderAssignment reference fields safe to fill from the loser side of a duplicate without
// risking a real figure — contributionPct is handled separately below because, unlike these, it is
// a real admin-declared figure (see the model's own doc comment) and a genuine mismatch must be
// reported, not silently picked.
const ASSIGNMENT_FILL_FIELDS = [
  "channel",
  "sourceContributionPct",
  "region",
  "subRegion",
  "workGroup",
  "company",
  "costCenterCount",
  "salesPoint",
  "route",
  "location",
  "absolutePrincipal",
  "supervisorId",
  "managerId",
  "stockPoint",
] as const;

async function run(tx: Prisma.TransactionClient) {
  const teamLeader = await tx.teamLeader.findFirst({ where: { name: TEAM_LEADER } });
  if (!teamLeader) throw new Error(`Team Leader "${TEAM_LEADER}" not found.`);

  const [oldEmp, newEmp] = await Promise.all([
    tx.employeeMaster.findUnique({ where: { employeeCode: OLD_CODE } }),
    tx.employeeMaster.findUnique({ where: { employeeCode: NEW_CODE } }),
  ]);

  log("\n1. Employee Master");
  if (!oldEmp && newEmp) {
    log(`  ${OLD_CODE} is already gone and ${NEW_CODE} (${newEmp.pineName}) exists: nothing to do here.`);
  } else if (!oldEmp) {
    throw new Error(`Neither ${OLD_CODE} nor ${NEW_CODE} has an Employee Master row — nothing to recode.`);
  } else if (!newEmp) {
    await tx.employeeMaster.update({ where: { id: oldEmp.id }, data: { employeeCode: NEW_CODE } });
    log(`  renamed ${oldEmp.pineName}'s Employee Master row from ${OLD_CODE} to ${NEW_CODE} (contributions carry over, same row).`);
  } else {
    const fill: Record<string, unknown> = {};
    for (const field of ROSTER_FIELDS) {
      const current = (newEmp as Record<string, unknown>)[field];
      const incoming = (oldEmp as Record<string, unknown>)[field];
      if ((current === null || current === undefined) && incoming !== null && incoming !== undefined) fill[field] = incoming;
    }
    if (Object.keys(fill).length > 0) {
      await tx.employeeMaster.update({ where: { id: newEmp.id }, data: fill });
      log(`  filled ${NEW_CODE}'s Employee Master row from ${OLD_CODE}: ${Object.keys(fill).join(", ")}.`);
    } else {
      log(`  ${NEW_CODE}'s Employee Master row already has its own values for everything ${OLD_CODE} would have supplied.`);
    }

    log("\n2. Principal contributions");
    const oldContributions = await tx.employeePrincipalContribution.findMany({ where: { employeeId: oldEmp.id } });
    const newContributionKeys = new Set((await tx.employeePrincipalContribution.findMany({ where: { employeeId: newEmp.id }, select: { principal: true } })).map((c) => c.principal));
    let contributionsMoved = 0;
    for (const c of oldContributions) {
      if (newContributionKeys.has(c.principal)) {
        log(`  ${c.principal}: ${NEW_CODE} already has its own contribution row — left on ${OLD_CODE}.`);
        continue;
      }
      await tx.employeePrincipalContribution.update({ where: { id: c.id }, data: { employeeId: newEmp.id } });
      contributionsMoved++;
    }
    log(`  ${contributionsMoved} contribution row(s) moved to ${NEW_CODE}.`);
  }

  log("\n3. Team Leader Assignments");
  const oldAssignments = await tx.teamLeaderAssignment.findMany({ where: { employeeCode: OLD_CODE } });
  if (oldAssignments.length === 0) {
    log(`  no Team Leader Assignment rows remain under ${OLD_CODE}.`);
  }
  for (const principal of EXPECTED_PRINCIPALS) {
    const found = oldAssignments.some((a) => a.teamLeaderId === teamLeader.id && a.principal === principal);
    if (!found && oldAssignments.length > 0) log(`  !! expected ${OLD_CODE} to have an assignment for ${principal} under ${TEAM_LEADER}; none found.`);
  }
  let assignmentsMoved = 0;
  let duplicatesFolded = 0;
  for (const a of oldAssignments) {
    const dup = await tx.teamLeaderAssignment.findUnique({
      where: { teamLeaderId_employeeCode_principal: { teamLeaderId: a.teamLeaderId, employeeCode: NEW_CODE, principal: a.principal } },
    });
    if (dup) {
      if (a.contributionPct !== null && dup.contributionPct !== null && a.contributionPct !== dup.contributionPct) {
        log(`  !! ${a.principal}: ${OLD_CODE} and ${NEW_CODE} both declare a contribution % that differs (${a.contributionPct} v ${dup.contributionPct}) — left on ${OLD_CODE}, resolve by hand.`);
        continue;
      }
      const fill: Record<string, unknown> = {};
      if (dup.contributionPct === null && a.contributionPct !== null) fill.contributionPct = a.contributionPct;
      for (const field of ASSIGNMENT_FILL_FIELDS) {
        const current = (dup as Record<string, unknown>)[field];
        const incoming = (a as Record<string, unknown>)[field];
        if ((current === null || current === undefined) && incoming !== null && incoming !== undefined) fill[field] = incoming;
      }
      if (Object.keys(fill).length > 0) await tx.teamLeaderAssignment.update({ where: { id: dup.id }, data: fill });
      await tx.teamLeaderAssignment.delete({ where: { id: a.id } });
      await tx.teamLeaderAssignmentAuditLog.create({
        data: {
          userEmail: AUDIT_USER,
          action: "DELETE",
          teamLeaderId: a.teamLeaderId,
          supervisorId: dup.supervisorId,
          principal: a.principal,
          employeeCode: OLD_CODE,
          changes: { removed: { old: `duplicate of ${NEW_CODE}'s own row for this principal${Object.keys(fill).length > 0 ? ` (filled: ${Object.keys(fill).join(", ")})` : ""}`, new: null } },
        },
      });
      duplicatesFolded++;
      log(`  ${a.principal}: ${NEW_CODE} already had its own row — folded${Object.keys(fill).length > 0 ? ` (${Object.keys(fill).join(", ")} from ${OLD_CODE})` : ""} and removed ${OLD_CODE}'s duplicate.`);
      continue;
    }
    await tx.teamLeaderAssignment.update({ where: { id: a.id }, data: { employeeCode: NEW_CODE } });
    await tx.teamLeaderAssignmentAuditLog.create({
      data: {
        userEmail: AUDIT_USER,
        action: "UPDATE",
        teamLeaderId: a.teamLeaderId,
        supervisorId: a.supervisorId,
        principal: a.principal,
        employeeCode: NEW_CODE,
        changes: { employeeCode: { old: OLD_CODE, new: NEW_CODE } },
      },
    });
    assignmentsMoved++;
    log(`  ${a.principal}: ${a.employeeName} re-keyed from ${OLD_CODE} to ${NEW_CODE}.`);
  }
  log(`  ${assignmentsMoved} assignment(s) re-keyed, ${duplicatesFolded} duplicate(s) folded.`);

  log("\n4. Retire the old row");
  const stillReferenced = (await tx.teamLeaderAssignment.count({ where: { employeeCode: OLD_CODE } })) > 0;
  const oldRowNow = await tx.employeeMaster.findUnique({ where: { employeeCode: OLD_CODE } });
  if (oldRowNow && oldRowNow.employeeCode !== NEW_CODE) {
    if (stillReferenced) {
      log(`  ${OLD_CODE} still has assignment(s) pointing at it — left in place, resolve the conflict above first.`);
    } else {
      await tx.employeeMaster.delete({ where: { id: oldRowNow.id } });
      log(`  deleted ${OLD_CODE}'s now-empty Employee Master row.`);
    }
  } else {
    log(`  nothing left under ${OLD_CODE}.`);
  }

  log(`\n5. ${NEW_CODE}'s assignments after this change:`);
  const finalAssignments = await tx.teamLeaderAssignment.findMany({ where: { employeeCode: NEW_CODE }, select: { principal: true, active: true, teamLeaderId: true } });
  for (const r of finalAssignments) log(`  ${r.principal}: ${r.teamLeaderId === teamLeader.id ? TEAM_LEADER : r.teamLeaderId}, ${r.active ? "active" : "inactive"}`);

  if (!apply) throw new DryRunRollback();
}

async function main() {
  log(apply ? "APPLY: changes will be committed." : "DRY RUN: everything is rolled back at the end.");
  try {
    await prisma.$transaction(run, { timeout: 120_000, maxWait: 60_000 });
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error;
    log("\nDRY RUN finished and rolled back. Re-run with --apply to commit.");
    return;
  }
  log("\nRecomputing rep contribution, daily targets and employee identities ...");
  await recomputeRosterDerived();
  log("Done.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
