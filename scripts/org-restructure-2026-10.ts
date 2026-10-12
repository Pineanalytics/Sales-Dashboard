// One-off organisation clean-up (October 2026), applying the structure in lib/orgRestructure.ts to production data.
//
//   npx tsx scripts/org-restructure-2026-10.ts            DRY RUN: does everything, prints it, then rolls it all back
//   npx tsx scripts/org-restructure-2026-10.ts --apply    the same, committed (then recomputes rep contribution and daily targets)
//
// Everything runs in ONE transaction, so it either lands completely or not at all; a problem (a conflict it cannot
// resolve safely) aborts an --apply run and leaves the data untouched. Back up the roster tables first (see the PR).
// Idempotent: a second run finds the work already done and changes nothing.
//
// ALREADY APPLIED (12 Oct 2026): do not run it again. Its step 1 (a Sales Supervisor named Alexander Muhoro) was superseded by
// scripts/eabl-under-hod-2026-10.ts, which puts Erick and Richard directly under the Head of Sales; re-running would recreate it.
//
// What it does, in order:
//   1. EABL gets a real Sales Supervisor (Alexander Muhoro). The stand-in supervisors "Erick" and "Richard" are merged into
//      him, so Erick and Richard are team leaders under him, as they should be.
//   2. The real team leaders are made so: Mars (Benson, Shekila, Lydiah John, Zachary Mwangi, Lewis Muthomi, Christine
//      Mweni) under Lucy, EABL (Erick, Richard) under Alexander. Emails are set so logins match by email.
//   3. Mars reps move to the team leader who owns their territory, taken from the Mars KPI roster's location. Key accounts
//      (KAM) goes to Lucy's own direct team.
//   4. Josephat's reps pass to Nickley, who replaced him.
//   5. The same person spelled two ways is merged (Eve / Eve Theuri, Eva / Eva Gachoki, Truphyline / Truphyline Apondi),
//      keeping the full name.
//   6. Supervisors' stand-in rows are marked SUPERVISOR_TEAM and leavers FORMER, so neither is offered as a team leader.
//   7. Logins are linked to the right row (Lewis, Zachary, Christine, Lydiah) and Emmy's login becomes a Supervisor login.
//      The logins of Calvince and Josephat, who are leaving, are NOT touched: remove or change them on /admin/users.
import { prisma } from "../lib/db";
import { mergeSupervisorsInTx, mergeTeamLeadersInTx, recomputeRosterDerived, type MergeTx } from "../lib/rosterMerge";
import {
  DUPLICATE_PAIRS,
  EABL_STAND_IN_SUPERVISORS,
  EABL_SUPERVISOR,
  FORMER_TEAM_LEADERS,
  MARS_PRINCIPAL_PREFIX,
  REAL_TEAM_LEADERS,
  SUCCESSION,
  SUPERVISOR_DIRECT_TEAMS,
  marsOwnerForLocation,
  planAssignmentMoves,
  type AssignmentLite,
} from "../lib/orgRestructure";

const apply = process.argv.includes("--apply");
class DryRunRollback extends Error {}

const problems: string[] = [];
const log = (message: string) => console.log(message);
const problem = (message: string) => {
  problems.push(message);
  console.log(`  !! PROBLEM: ${message}`);
};

/** Supervisor emails, so the Users page matches each login to its row (login emails are the source of truth). */
const SUPERVISOR_EMAILS: Record<string, string> = {
  Lucy: "lucy.wanjiku@pinefrost.co.ke",
  Nickley: "nickley.mageto@pinefrost.co.ke",
  Eve: "eve.theuri@pinefrost.co.ke",
  Emmy: "emily.mbithe@pinefrost.co.ke",
};

/** Logins to attach to a team leader row, with the name to show if the login has none. */
const LOGIN_LINKS: { email: string; teamLeader: string; name: string }[] = [
  { email: "zachary.mwangi@pinefrost.co.ke", teamLeader: "Zachary Mwangi", name: "Zachary Mwangi" },
  { email: "christine.mweni@pinefrost.co.ke", teamLeader: "Christine Mweni", name: "Christine Mweni" },
  { email: "lewis.muthomi@pinefrost.co.ke", teamLeader: "Lewis Muthomi", name: "Lewis Muthomi" },
  { email: "lydiah.john@pinefrost.co.ke", teamLeader: "Lydiah John", name: "Lydiah John" },
];

async function unusedEmail(tx: MergeTx, model: "teamLeader" | "supervisor", email: string, exceptId?: string): Promise<boolean> {
  const where = { email, ...(exceptId ? { NOT: { id: exceptId } } : {}) };
  const found = model === "teamLeader" ? await tx.teamLeader.findFirst({ where, select: { id: true } }) : await tx.supervisor.findFirst({ where, select: { id: true } });
  return !found;
}

/** Moves assignments per a plan: a duplicate (the target already holds the rep) is removed, reactivating the target's
 *  row if the source's was the live one. Keeps EmployeeMaster's home team leader in step. */
async function applyMoves(tx: MergeTx, moves: ReturnType<typeof planAssignmentMoves>, sources: AssignmentLite[], targetOf: (code: string) => string, label: string) {
  const byId = new Map(sources.map((a) => [a.id, a]));
  for (const move of moves.moves) {
    const row = byId.get(move.id)!;
    await tx.teamLeaderAssignment.update({ where: { id: move.id }, data: { teamLeaderId: move.toTeamLeaderId } });
    await tx.employeeMaster.updateMany({ where: { employeeCode: row.employeeCode, teamLeaderId: row.teamLeaderId }, data: { teamLeaderId: move.toTeamLeaderId } });
  }
  for (const dup of moves.duplicates) {
    const row = byId.get(dup.id)!;
    const target = await tx.teamLeaderAssignment.findFirst({ where: { teamLeaderId: targetOf(row.employeeCode), employeeCode: row.employeeCode, principal: row.principal }, select: { id: true, active: true } });
    if (target && !target.active && row.active) await tx.teamLeaderAssignment.update({ where: { id: target.id }, data: { active: true } });
    await tx.teamLeaderAssignment.delete({ where: { id: dup.id } });
  }
  log(`  ${label}: moved ${moves.moves.length}, removed ${moves.duplicates.length} duplicate(s), already in place ${moves.unchanged}, owner unknown (left as is) ${moves.unmapped}.`);
}

/** Resolves what a team leader merge would otherwise leave behind: the loser's copy of an assignment the winner already
 *  holds, and weekly targets for a week both have. Anything that differs in real figures is reported, never overwritten. */
async function clearMergeConflicts(tx: MergeTx, winnerId: string, loserId: string, loserName: string) {
  const winnerAssignments = await tx.teamLeaderAssignment.findMany({ where: { teamLeaderId: winnerId }, select: { id: true, employeeCode: true, principal: true, active: true } });
  const winnerByKey = new Map(winnerAssignments.map((a) => [`${a.employeeCode}|${a.principal}`, a]));
  let removed = 0;
  for (const a of await tx.teamLeaderAssignment.findMany({ where: { teamLeaderId: loserId }, select: { id: true, employeeCode: true, principal: true, active: true } })) {
    const twin = winnerByKey.get(`${a.employeeCode}|${a.principal}`);
    if (!twin) continue;
    if (a.active && !twin.active) await tx.teamLeaderAssignment.update({ where: { id: twin.id }, data: { active: true } });
    await tx.teamLeaderAssignment.delete({ where: { id: a.id } });
    removed += 1;
  }

  const winnerWeeks = new Map((await tx.weeklyTarget.findMany({ where: { teamLeaderId: winnerId }, select: { id: true, principal: true, weekStartDate: true, targetValue: true } })).map((w) => [`${w.principal}|${w.weekStartDate.getTime()}`, w]));
  let weeksFolded = 0;
  for (const w of await tx.weeklyTarget.findMany({ where: { teamLeaderId: loserId }, select: { id: true, principal: true, weekStartDate: true, targetValue: true } })) {
    const twin = winnerWeeks.get(`${w.principal}|${w.weekStartDate.getTime()}`);
    if (!twin) continue;
    if (w.targetValue !== 0 && twin.targetValue !== 0 && w.targetValue !== twin.targetValue) {
      problem(`Weekly target for ${w.principal} week of ${w.weekStartDate.toISOString().slice(0, 10)} differs on both sides of ${loserName} (${w.targetValue} v ${twin.targetValue}).`);
      continue;
    }
    if (twin.targetValue === 0 && w.targetValue !== 0) await tx.weeklyTarget.update({ where: { id: twin.id }, data: { targetValue: w.targetValue } });
    await tx.weeklyTarget.delete({ where: { id: w.id } });
    weeksFolded += 1;
  }
  if (removed > 0 || weeksFolded > 0) log(`  ${loserName}: removed ${removed} duplicate assignment(s), folded ${weeksFolded} duplicate weekly target(s) into the row kept.`);
}

async function run(tx: MergeTx) {
  const team = (name: string) => tx.teamLeader.findUnique({ where: { name } });
  const supervisor = (name: string) => tx.supervisor.findUnique({ where: { name } });

  log("\n1. EABL supervisor");
  const hod = await tx.hod.findUnique({ where: { name: EABL_SUPERVISOR.hod } });
  if (!hod) throw new Error(`Head of Sales "${EABL_SUPERVISOR.hod}" not found.`);
  let alexander = await supervisor(EABL_SUPERVISOR.name);
  if (!alexander) {
    alexander = await tx.supervisor.create({ data: { name: EABL_SUPERVISOR.name, email: EABL_SUPERVISOR.email, directHodId: hod.id } });
    log(`  created Supervisor ${alexander.name} under Head of Sales ${hod.name}.`);
  } else if (!alexander.email && (await unusedEmail(tx, "supervisor", EABL_SUPERVISOR.email, alexander.id))) {
    alexander = await tx.supervisor.update({ where: { id: alexander.id }, data: { email: EABL_SUPERVISOR.email } });
  }
  for (const name of EABL_STAND_IN_SUPERVISORS) {
    const standIn = await supervisor(name);
    if (!standIn) continue;
    const merged = await mergeSupervisorsInTx(tx, alexander.id, standIn.id);
    log(`  merged stand-in supervisor "${name}" into ${alexander.name}: ${JSON.stringify(merged.reassigned)}.`);
    if (!merged.loserDeleted) problem(`Could not remove stand-in supervisor "${name}": ${merged.conflicts.join("; ")}`);
  }

  log("\n2. Real team leaders");
  const tlIdByName = new Map<string, string>();
  for (const spec of REAL_TEAM_LEADERS) {
    let row = await team(spec.name);
    if (!row && spec.renameFrom) {
      const old = await team(spec.renameFrom);
      if (old) {
        row = await tx.teamLeader.update({ where: { id: old.id }, data: { name: spec.name } });
        log(`  renamed "${spec.renameFrom}" to "${spec.name}".`);
      }
    }
    const boss = await supervisor(spec.supervisor);
    if (!boss) throw new Error(`Supervisor "${spec.supervisor}" not found.`);
    const email = (await unusedEmail(tx, "teamLeader", spec.email, row?.id)) ? spec.email : null;
    if (!email) problem(`${spec.email} is already used by another team leader row.`);
    if (!row) {
      row = await tx.teamLeader.create({ data: { name: spec.name, email, kind: "TEAM_LEADER", supervisorId: boss.id } });
      log(`  created Team Leader ${spec.name} under ${boss.name}.`);
    } else {
      row = await tx.teamLeader.update({ where: { id: row.id }, data: { kind: "TEAM_LEADER", supervisorId: boss.id, ...(email && !row.email ? { email } : {}) } });
    }
    tlIdByName.set(spec.name, row.id);
  }

  log("\n3. Mars reps to their territory's team leader");
  const lucyTeam = await team("Lucy");
  if (!lucyTeam) throw new Error('Lucy\'s direct team row ("Lucy") not found.');
  const roster = await tx.principalKpiRoster.findMany({ where: { principal: { startsWith: MARS_PRINCIPAL_PREFIX } }, select: { employeeCode: true, location: true } });
  const locationByCode = new Map(roster.map((r) => [r.employeeCode, r.location]));
  const marsOwnerId = (code: string): string | null => {
    const owner = marsOwnerForLocation(locationByCode.get(code));
    if (!owner) return null;
    return owner.kind === "DIRECT" ? lucyTeam.id : (tlIdByName.get(owner.name) ?? null);
  };
  const marsAll = await tx.teamLeaderAssignment.findMany({ where: { principal: { startsWith: MARS_PRINCIPAL_PREFIX } }, select: { id: true, teamLeaderId: true, employeeCode: true, principal: true, active: true } });
  const marsLive = marsAll.filter((a) => a.active);
  await applyMoves(tx, planAssignmentMoves(marsLive, marsOwnerId, marsAll), marsLive, (code) => marsOwnerId(code)!, "Mars");

  log("\n4. Succession");
  for (const { from, to } of SUCCESSION) {
    const fromTeam = await team(from);
    const toTeam = await team(to);
    if (!fromTeam || !toTeam) continue;
    const fromRows = await tx.teamLeaderAssignment.findMany({ where: { teamLeaderId: fromTeam.id }, select: { id: true, teamLeaderId: true, employeeCode: true, principal: true, active: true } });
    const toRows = await tx.teamLeaderAssignment.findMany({ where: { teamLeaderId: toTeam.id }, select: { id: true, teamLeaderId: true, employeeCode: true, principal: true, active: true } });
    await applyMoves(tx, planAssignmentMoves(fromRows, () => toTeam.id, [...fromRows, ...toRows]), fromRows, () => toTeam.id, `${from} to ${to}`);
    const principals = await tx.principal.updateMany({ where: { teamLeaderId: fromTeam.id }, data: { teamLeaderId: toTeam.id } });
    if (principals.count > 0) log(`  ${principals.count} principal(s) now point at ${to}.`);
  }

  log("\n5. Same person, two spellings");
  for (const { keep, mergeAway } of DUPLICATE_PAIRS) {
    const winner = await team(keep);
    const loser = await team(mergeAway);
    if (!loser) continue;
    if (!winner) {
      await tx.teamLeader.update({ where: { id: loser.id }, data: { name: keep } });
      log(`  renamed "${mergeAway}" to "${keep}" (no second row to merge).`);
      continue;
    }
    await clearMergeConflicts(tx, winner.id, loser.id, mergeAway);
    const merged = await mergeTeamLeadersInTx(tx, winner.id, loser.id);
    log(`  merged "${mergeAway}" into "${keep}": ${JSON.stringify(merged.reassigned)}${merged.loserDeleted ? "" : " (row kept)"}.`);
    for (const c of merged.conflicts) problem(`${mergeAway} into ${keep}: ${c}`);
  }

  log("\n6. Mark supervisors' direct teams and leavers");
  for (const name of SUPERVISOR_DIRECT_TEAMS) {
    const row = await team(name);
    if (!row) continue;
    if (row.kind !== "SUPERVISOR_TEAM") await tx.teamLeader.update({ where: { id: row.id }, data: { kind: "SUPERVISOR_TEAM" } });
  }
  log(`  ${SUPERVISOR_DIRECT_TEAMS.length} stand-in row(s) marked as supervisors' direct teams.`);
  for (const name of FORMER_TEAM_LEADERS) {
    const row = await team(name);
    if (!row) continue;
    const live = await tx.teamLeaderAssignment.count({ where: { teamLeaderId: row.id, active: true } });
    if (live > 0) {
      problem(`${name} still has ${live} active assignment(s); they need an owner before ${name} can be marked former.`);
      continue;
    }
    if (row.kind !== "FORMER") await tx.teamLeader.update({ where: { id: row.id }, data: { kind: "FORMER" } });
    log(`  ${name} marked former.`);
  }

  log("\n7. Logins and supervisor emails");
  for (const [name, email] of Object.entries(SUPERVISOR_EMAILS)) {
    const row = await supervisor(name);
    if (row && !row.email && (await unusedEmail(tx, "supervisor", email, row.id))) await tx.supervisor.update({ where: { id: row.id }, data: { email } });
  }
  for (const link of LOGIN_LINKS) {
    const user = await tx.user.findUnique({ where: { email: link.email } });
    const row = await team(link.teamLeader);
    if (!user || !row) {
      log(`  skipped ${link.email}: ${!user ? "no such login" : "no such team leader row"}.`);
      continue;
    }
    const holder = await tx.user.findFirst({ where: { teamLeaderId: row.id, NOT: { id: user.id } }, select: { email: true } });
    if (holder) {
      problem(`${holder.email} is already linked to ${link.teamLeader}.`);
      continue;
    }
    await tx.user.update({ where: { id: user.id }, data: { teamLeaderId: row.id, supervisorId: null, role: "TEAM_LEADER", ...(user.name?.trim() ? {} : { name: link.name }) } });
    log(`  ${link.email} is now the ${link.teamLeader} team leader login.`);
  }
  // A Team Leader login pointing at a supervisor's stand-in row is really a Supervisor login.
  const standInLogins = await tx.user.findMany({ where: { role: "TEAM_LEADER", teamLeaderId: { not: null } }, select: { id: true, email: true, teamLeaderId: true } });
  for (const login of standInLogins) {
    const row = await tx.teamLeader.findUnique({ where: { id: login.teamLeaderId! } });
    if (!row || row.kind !== "SUPERVISOR_TEAM" || !row.supervisorId) continue;
    const holder = await tx.user.findFirst({ where: { supervisorId: row.supervisorId, NOT: { id: login.id } }, select: { email: true } });
    if (holder) {
      problem(`${login.email} should be a Supervisor login but ${holder.email} already holds that Supervisor row.`);
      continue;
    }
    await tx.user.update({ where: { id: login.id }, data: { role: "SUPERVISOR", supervisorId: row.supervisorId, teamLeaderId: null } });
    log(`  ${login.email} changed from Team Leader to Supervisor.`);
  }
  for (const name of FORMER_TEAM_LEADERS) {
    const row = await team(name);
    const login = row ? await tx.user.findFirst({ where: { teamLeaderId: row.id }, select: { email: true, role: true } }) : null;
    if (login) log(`  NOTE: ${login.email} (${login.role}) is still linked to ${name}, who is leaving. Left as is: remove or change it on /admin/users.`);
  }

  log("\nResult: active Mars reps per team leader");
  const finalMars = await tx.teamLeaderAssignment.groupBy({ by: ["teamLeaderId"], where: { principal: { startsWith: MARS_PRINCIPAL_PREFIX }, active: true }, _count: { _all: true } });
  const names = new Map((await tx.teamLeader.findMany({ select: { id: true, name: true, kind: true } })).map((t) => [t.id, `${t.name} [${t.kind}]`]));
  for (const row of finalMars.sort((a, b) => b._count._all - a._count._all)) log(`  ${String(row._count._all).padStart(4)}  ${names.get(row.teamLeaderId) ?? row.teamLeaderId}`);

  if (problems.length > 0 && apply) throw new Error(`${problems.length} problem(s) found; nothing was changed.\n- ${problems.join("\n- ")}`);
  if (!apply) throw new DryRunRollback();
}

async function main() {
  log(apply ? "APPLY: changes will be committed." : "DRY RUN: everything is rolled back at the end.");
  try {
    await prisma.$transaction(run, { timeout: 600_000, maxWait: 60_000 });
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error;
    log(`\nDRY RUN finished and rolled back. ${problems.length} problem(s). Re-run with --apply to commit.`);
    return;
  }
  log("\nCommitted. Recomputing rep contribution and daily targets...");
  await recomputeRosterDerived();
  log("Done.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
