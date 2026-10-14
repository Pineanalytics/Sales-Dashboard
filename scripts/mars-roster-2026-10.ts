// One-off Mars roster update (October 2026): applies the "Mars Employee Roaster" file to production.
//
//   node --import tsx scripts/mars-roster-2026-10.ts <roster.csv>            DRY RUN: does everything, prints it, rolls it all back
//   node --import tsx scripts/mars-roster-2026-10.ts <roster.csv> --apply    the same, committed (then recomputes rep contribution and daily targets)
//   --inactive-after-days=N                                                   a rep with no Mars sale for more than N days is Inactive (default 90)
//
// Everything runs in ONE transaction, so it lands completely or not at all; a problem it cannot resolve safely aborts an --apply run.
// Back up the roster tables first. Idempotent: a second run finds the work done and changes nothing.
//
// What it does:
//   1. Reads the roster file and checks every region / sub-region pair against the Mars structure (lib/marsStructure.ts).
//   2. Decides who is an Active and who an Inactive worker (lib/marsRoster.ts): a Mars sale in the last 90 days.
//   3. Mars Team Leader assignments: every rep in the file gets the file's Team Leader, region, sub-region and group; the row's active flag
//      follows the rep's status; active reps with no assignment are added. Reps not in the file are left as they are.
//   4. The employee master follows (same fields; new active reps are added).
//   5. The Mars KPI roster is replaced by the file (every row, with its status); rows not in the file are made inactive.
//   6. Other principals: a blank sub-region defaults by region (Nairobi Metro, Upper Eastern, Central); nothing else about them changes.
import { readFileSync } from "node:fs";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/db";
import { recomputeRosterDerived } from "../lib/rosterAssignment";
import { DEFAULT_SUB_REGION, MARS_PRINCIPAL, defaultSubRegion } from "../lib/marsStructure";
import { CODE_ALIASES, RETIRED_REPS, classifyReps, cleanName, nameKey, parseMarsRosterCsv, planAssignments, withExtraReps, type ExistingAssignment, type RepActivity, type RosterCsvRow } from "../lib/marsRoster";
import { MARS_LOCATION_OWNER } from "../lib/orgRestructure";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const file = args.find((a) => !a.startsWith("--"));
const afterArg = args.find((a) => a.startsWith("--inactive-after-days="));
const inactiveAfterDays = afterArg ? Number(afterArg.split("=")[1]) : 90;
class DryRunRollback extends Error {}

const problems: string[] = [];
const log = (message: string) => console.log(message);
const problem = (message: string) => {
  problems.push(message);
  console.log(`  !! PROBLEM: ${message}`);
};
const salesRoleOf = (sellerType: string) => (/primary/i.test(sellerType) ? "PRIMARY" : "SECONDARY");
const KPI_PRINCIPAL = "Mars";

async function run(tx: Prisma.TransactionClient) {
  if (!file) throw new Error("Give the roster file: node --import tsx scripts/mars-roster-2026-10.ts <roster.csv> [--apply]");
  log("\n1. Roster file");
  const parsed = parseMarsRosterCsv(readFileSync(file, "utf8"));
  for (const p of parsed.problems) problem(p);
  const extra = withExtraReps(parsed.rows);
  const rows = extra.rows;
  log(`  ${parsed.rows.length} reps read.`);
  for (const r of extra.added) log(`  + ${r.employeeName} (${r.employeeCode}) is not in the file; placed by the business in ${r.location} under ${r.teamLeader}.`);

  const teamLeaders = new Map((await tx.teamLeader.findMany({ select: { id: true, name: true } })).map((t) => [t.name, t.id]));
  for (const name of new Set(rows.map((r) => r.teamLeader))) if (!teamLeaders.has(name)) problem(`Team Leader "${name}" is not in the roster's Team Leader list.`);
  for (const r of rows) {
    const owner = MARS_LOCATION_OWNER[r.location];
    if (owner && owner !== r.teamLeader && r.teamLeader !== r.employeeName) log(`  note: ${r.employeeName} (${r.employeeCode}) is in ${r.location}, owned by ${owner}, but the file puts them under ${r.teamLeader}: kept as the file says.`);
  }

  log("\n2. Active and inactive workers");
  const activityRows = await tx.$queryRaw<{ name: string; events90: number; lastSale: Date | null; days: number }[]>(Prisma.sql`
    SELECT "repName" AS name,
           COUNT(*) FILTER (WHERE date >= now() - make_interval(days => ${inactiveAfterDays}::int))::int AS events90,
           MAX(date) AS "lastSale",
           COUNT(DISTINCT date::date) FILTER (WHERE date >= now() - make_interval(days => ${inactiveAfterDays}::int))::int AS days
    FROM "ActiveOutletEvent"
    WHERE year = (SELECT MAX(year) FROM "ActiveOutlet") AND principal ~* '^mars' AND "repName" IS NOT NULL
    GROUP BY "repName"`);
  const activity = new Map<string, RepActivity>();
  for (const r of activityRows) {
    const key = nameKey(r.name);
    const known = activity.get(key);
    const next: RepActivity = { name: key, events90: r.events90, lastSale: r.lastSale, activeDays90: r.days };
    if (!known) activity.set(key, next);
    else activity.set(key, { name: key, events90: known.events90 + next.events90, activeDays90: known.activeDays90 + next.activeDays90, lastSale: [known.lastSale, next.lastSale].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null });
  }
  const existingRows = await tx.teamLeaderAssignment.findMany({
    where: { principal: { startsWith: "Mars" } },
    select: { id: true, teamLeaderId: true, employeeCode: true, active: true, region: true, subRegion: true, workGroup: true, principal: true },
  });
  const leaderName = new Map([...teamLeaders].map(([name, id]) => [id, name]));
  const existing: ExistingAssignment[] = existingRows.map((a) => ({ ...a, teamLeaderName: leaderName.get(a.teamLeaderId) ?? a.teamLeaderId }));
  const liveCodes = new Set(existing.filter((a) => a.active).map((a) => a.employeeCode));
  const classes = classifyReps(rows, activity, liveCodes, new Date(), inactiveAfterDays);
  const activeCount = [...classes.values()].filter((c) => c.status === "Active").length;
  log(`  Active (a Mars sale in the last ${inactiveAfterDays} days): ${activeCount}. Inactive: ${rows.length - activeCount}, of whom ${[...classes.values()].filter((c) => c.retired).length} retired.`);
  const inactiveByReason = new Map<string, number>();
  for (const c of classes.values()) if (c.status === "Inactive") inactiveByReason.set(c.reason.replace(/\d{4}-\d{2}-\d{2}.*$/, "").trim() || c.reason, (inactiveByReason.get(c.reason.replace(/\d{4}-\d{2}-\d{2}.*$/, "").trim() || c.reason) ?? 0) + 1);
  for (const [reason, n] of inactiveByReason) log(`    inactive: ${String(n).padStart(3)}  ${reason}`);

  log("\n3. Mars Team Leader assignments");
  const plan = planAssignments(rows, classes, existing);
  log(`  to add (active, not on the roster yet): ${plan.created} | Team Leader changes: ${plan.moved} | region/sub-region changes: ${plan.regionChanged} | made inactive: ${plan.deactivated} | reactivated: ${plan.activated}`);
  for (const action of plan.actions) {
    if (action.kind === "create") {
      const owner = teamLeaders.get(action.row.teamLeader);
      if (!owner) continue;
      log(`  + add ${action.row.employeeName} (${action.row.employeeCode}, ${action.row.employeeGroup}) to ${action.row.teamLeader}, ${action.row.region}/${action.row.location}`);
      await tx.teamLeaderAssignment.create({
        data: { teamLeaderId: owner, employeeCode: action.row.employeeCode, employeeName: action.row.employeeName, principal: MARS_PRINCIPAL, region: action.row.region, subRegion: action.row.location, workGroup: action.row.employeeGroup, salesRole: salesRoleOf(action.row.sellerType), active: true },
      });
    } else if (action.kind === "update") {
      log(`  ~ ${action.row.employeeName} (${action.row.employeeCode}): ${action.changes.join("; ")}`);
      const data: Prisma.TeamLeaderAssignmentUncheckedUpdateInput = { region: action.row.region, subRegion: action.row.location, workGroup: action.row.employeeGroup, active: action.status === "Active" };
      if (action.moveTeamLeader) {
        const target = teamLeaders.get(action.row.teamLeader);
        if (!target) continue;
        const twin = await tx.teamLeaderAssignment.findFirst({ where: { teamLeaderId: target, employeeCode: action.existing.employeeCode, principal: MARS_PRINCIPAL }, select: { id: true } });
        if (twin) {
          // the target Team Leader already holds this rep: keep that row, drop this one
          await tx.teamLeaderAssignment.update({ where: { id: twin.id }, data: { region: action.row.region, subRegion: action.row.location, workGroup: action.row.employeeGroup, active: action.status === "Active" } });
          await tx.teamLeaderAssignment.delete({ where: { id: action.existing.id } });
          continue;
        }
        data.teamLeaderId = target;
      }
      await tx.teamLeaderAssignment.update({ where: { id: action.existing.id }, data });
    }
  }
  if (plan.notInFile.length > 0) {
    log(`  Mars assignments not in the file (left as they are): ${plan.notInFile.map((a) => `${a.employeeCode} [${a.teamLeaderName}]`).join(", ")}`);
  }

  log("\n4. Employee master");
  let emUpdated = 0;
  let emCreated = 0;
  const byCode = new Map(rows.map((r) => [r.employeeCode, r]));
  for (const [code, row] of byCode) {
    const status = classes.get(code)?.status ?? "Inactive";
    const leaderId = teamLeaders.get(row.teamLeader);
    if (!leaderId) continue;
    const found = await tx.employeeMaster.findUnique({ where: { employeeCode: code }, select: { id: true } });
    if (found) {
      await tx.employeeMaster.update({ where: { id: found.id }, data: { region: row.region, subRegion: row.location, workGroup: row.employeeGroup, teamLeader: row.teamLeader, teamLeaderId: leaderId, active: status === "Active" } });
      emUpdated += 1;
    } else if (status === "Active") {
      await tx.employeeMaster.create({ data: { employeeCode: code, pineName: row.employeeName, sapName: row.employeeName, absolutePrincipal: MARS_PRINCIPAL, salesRole: row.sellerType, workGroup: row.employeeGroup, region: row.region, subRegion: row.location, teamLeader: row.teamLeader, teamLeaderId: leaderId, active: true } });
      emCreated += 1;
    }
  }
  log(`  updated ${emUpdated}, added ${emCreated}.`);

  log("\n5. Mars KPI roster");
  for (const row of rows) {
    const c = classes.get(row.employeeCode)!;
    const data = { employeeName: row.employeeName, employeeGroup: row.employeeGroup, location: row.location, teamLeader: row.teamLeader, sellerType: row.sellerType, active: c.status === "Active", activeDays: c.activeDays };
    await tx.principalKpiRoster.upsert({ where: { principal_employeeCode: { principal: KPI_PRINCIPAL, employeeCode: row.employeeCode } }, create: { principal: KPI_PRINCIPAL, employeeCode: row.employeeCode, ...data }, update: data });
  }
  const dropped = await tx.principalKpiRoster.updateMany({ where: { principal: KPI_PRINCIPAL, employeeCode: { notIn: rows.map((r) => r.employeeCode) }, active: true }, data: { active: false } });
  log(`  ${rows.length} rows written (${activeCount} active); ${dropped.count} row(s) not in the file made inactive.`);

  log("\n6. Other principals: blank sub-regions");
  const others = await tx.teamLeaderAssignment.findMany({ where: { NOT: { principal: { startsWith: "Mars" } }, OR: [{ subRegion: null }, { subRegion: "" }] }, select: { id: true, principal: true, region: true } });
  const regionOfPrincipal = (principal: string): [string, string] | null => {
    if (/-nairobi$/i.test(principal)) return ["Nairobi", DEFAULT_SUB_REGION.Nairobi];
    if (/-nyeri$/i.test(principal)) return ["Nyeri", DEFAULT_SUB_REGION.Central];
    if (/-nyahururu$/i.test(principal)) return ["Nyahururu", DEFAULT_SUB_REGION.Central];
    return null;
  };
  let filled = 0;
  for (const a of others) {
    const region = (a.region ?? "").trim();
    const sub = region ? defaultSubRegion(a.principal, region) : null;
    const placement = region ? (sub ? ([region, sub] as [string, string]) : null) : regionOfPrincipal(a.principal);
    if (!placement) continue;
    await tx.teamLeaderAssignment.update({ where: { id: a.id }, data: { region: placement[0], subRegion: placement[1] } });
    filled += 1;
  }
  log(`  ${filled} of ${others.length} assignment(s) with no sub-region filled in.`);

  log("\n7. Codes of one person");
  for (const [alias, canonical] of Object.entries(CODE_ALIASES)) {
    const lines = await tx.principalKpiSaleLine.updateMany({ where: { employeeCode: alias }, data: { employeeCode: canonical } });
    const aliasTargets = await tx.principalKpiTarget.findMany({ where: { employeeCode: alias }, select: { id: true, principal: true, fiscalYear: true, periodKey: true, volumeTarget: true, valueTarget: true } });
    let movedTargets = 0;
    let droppedTargets = 0;
    for (const t of aliasTargets) {
      const twin = await tx.principalKpiTarget.findFirst({ where: { principal: t.principal, fiscalYear: t.fiscalYear, periodKey: t.periodKey, employeeCode: canonical }, select: { id: true, volumeTarget: true, valueTarget: true } });
      if (twin) {
        // both codes carry a target for the period: the current code's row stays (adding them would double the person's target)
        log(`  target ${t.fiscalYear} ${t.periodKey}: ${alias} had volume ${t.volumeTarget ?? 0} / value ${t.valueTarget ?? 0}, ${canonical} keeps volume ${twin.volumeTarget ?? 0} / value ${twin.valueTarget ?? 0}; the ${alias} row is dropped.`);
        await tx.principalKpiTarget.delete({ where: { id: t.id } });
        droppedTargets += 1;
      } else {
        await tx.principalKpiTarget.update({ where: { id: t.id }, data: { employeeCode: canonical } });
        movedTargets += 1;
      }
    }
    log(`  ${alias} combined into ${canonical}: ${lines.count} sale line(s) moved, ${movedTargets} target(s) moved, ${droppedTargets} duplicate target(s) dropped.`);
  }
  log(`  Retired (kept Inactive, shown as Retired): ${RETIRED_REPS.map((r) => `${r.name} ${r.code}`).join(", ")}.`);

  log("\nResult: active Mars reps per Team Leader and sub-region");
  const final = await tx.teamLeaderAssignment.groupBy({ by: ["teamLeaderId", "subRegion"], where: { principal: MARS_PRINCIPAL, active: true }, _count: { _all: true } });
  for (const g of final.sort((a, b) => (a.subRegion ?? "").localeCompare(b.subRegion ?? ""))) log(`  ${String(g._count._all).padStart(4)}  ${(g.subRegion ?? "-").padEnd(22)} ${leaderName.get(g.teamLeaderId) ?? g.teamLeaderId}`);

  if (problems.length > 0 && apply) throw new Error(`${problems.length} problem(s) found; nothing was changed.\n- ${problems.join("\n- ")}`);
  if (!apply) throw new DryRunRollback();
}

async function main() {
  log(apply ? "APPLY: changes will be committed." : "DRY RUN: everything is rolled back at the end.");
  log(`A rep is Inactive after ${inactiveAfterDays} days without a Mars sale.`);
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

void cleanName;
