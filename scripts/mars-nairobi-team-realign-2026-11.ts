// One-off (6 Nov 2026): realign Mars-Nairobi's three Team Leader rosters to the business-supplied Nairobi Team
// roster — Nairobi Lower under Zachary Mwangi, Nairobi South under Benson Mbivi, Nairobi Metro under Lewis
// Muthomi. Every listed rep's Mars-Nairobi assignment moves to their indicated Team Leader and sub-region,
// active (moving an existing row if they were under someone else, folding away any leftover duplicate, or
// creating a fresh one if they had none); EmployeeMaster's own "home" Team Leader is realigned the same way,
// not just filled in when blank, since this is an authoritative move, not identity resolution.
//
// Every other currently-active Mars-Nairobi assignment in these three sub-regions, whoever holds it, not on
// this list is marked inactive. Nairobi Key Accounts (no Team Leader of its own, not in this file) is left
// alone entirely - only Nairobi Lower/Metro/South are touched.
//
// James Ndambuki is entered here under 1032, his current code since the 12 January 2026 recode recorded in
// lib/marsRoster.ts's CODE_ALIASES - the source file still has his retired code, 1028.
//
//   node --import tsx scripts/mars-nairobi-team-realign-2026-11.ts            DRY RUN: does everything, prints it, rolls it all back
//   node --import tsx scripts/mars-nairobi-team-realign-2026-11.ts --apply    the same, committed (then recomputes rep contribution and daily targets)
//
// Run it on the 1 GB sap-sync-worker container. One transaction; idempotent (a second run finds the work done).
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/db";
import { recomputeRosterDerived } from "../lib/rosterAssignment";
import { MARS_PRINCIPAL } from "../lib/marsStructure";

const apply = process.argv.includes("--apply");
class DryRunRollback extends Error {}
const log = (message: string) => console.log(message);
const AUDIT_USER = "system: mars nairobi team realign 2026-11-06";

const NAIROBI_SUBREGIONS = ["Nairobi Lower", "Nairobi Metro", "Nairobi South"];

interface Row {
  teamLeader: string;
  subRegion: string;
  employeeCode: string;
  employeeName: string;
}

const ROWS: Row[] = [
  { teamLeader: "Zachary Mwangi", subRegion: "Nairobi Lower", employeeCode: "1167", employeeName: "Beatrice Bakhoya" },
  { teamLeader: "Zachary Mwangi", subRegion: "Nairobi Lower", employeeCode: "1076", employeeName: "Beatrice Nanjala" },
  { teamLeader: "Zachary Mwangi", subRegion: "Nairobi Lower", employeeCode: "1217", employeeName: "Christine Mutua" },
  { teamLeader: "Zachary Mwangi", subRegion: "Nairobi Lower", employeeCode: "1019", employeeName: "David Musyoka" },
  { teamLeader: "Zachary Mwangi", subRegion: "Nairobi Lower", employeeCode: "1176", employeeName: "Harrison Mwamba" },
  { teamLeader: "Zachary Mwangi", subRegion: "Nairobi Lower", employeeCode: "1172", employeeName: "Hilda Mieni" },
  { teamLeader: "Zachary Mwangi", subRegion: "Nairobi Lower", employeeCode: "1156", employeeName: "Jackson Omondi" },
  { teamLeader: "Zachary Mwangi", subRegion: "Nairobi Lower", employeeCode: "660", employeeName: "Kelvin Munene" },
  { teamLeader: "Zachary Mwangi", subRegion: "Nairobi Lower", employeeCode: "592", employeeName: "Kevin Komo" },
  { teamLeader: "Zachary Mwangi", subRegion: "Nairobi Lower", employeeCode: "1132", employeeName: "Lucy Anne Mukami" },
  { teamLeader: "Zachary Mwangi", subRegion: "Nairobi Lower", employeeCode: "1168", employeeName: "Rashid Maingi" },
  { teamLeader: "Zachary Mwangi", subRegion: "Nairobi Lower", employeeCode: "911", employeeName: "Rose Nduku" },
  { teamLeader: "Zachary Mwangi", subRegion: "Nairobi Lower", employeeCode: "1010", employeeName: "Thomas Mutunga Yuta" },
  { teamLeader: "Zachary Mwangi", subRegion: "Nairobi Lower", employeeCode: "1106", employeeName: "Wycliffe Okari" },

  { teamLeader: "Benson Mbivi", subRegion: "Nairobi South", employeeCode: "1109", employeeName: "Beryl Onyango" },
  { teamLeader: "Benson Mbivi", subRegion: "Nairobi South", employeeCode: "1099", employeeName: "Brandy Achieng" },
  { teamLeader: "Benson Mbivi", subRegion: "Nairobi South", employeeCode: "604", employeeName: "Brian Kipkemoi" },
  { teamLeader: "Benson Mbivi", subRegion: "Nairobi South", employeeCode: "1103", employeeName: "Catherine Karimi" },
  { teamLeader: "Benson Mbivi", subRegion: "Nairobi South", employeeCode: "871", employeeName: "Catherine Mutheu" },
  { teamLeader: "Benson Mbivi", subRegion: "Nairobi South", employeeCode: "1206", employeeName: "Denis Mwangi" },
  { teamLeader: "Benson Mbivi", subRegion: "Nairobi South", employeeCode: "601", employeeName: "Elly Odongo" },
  { teamLeader: "Benson Mbivi", subRegion: "Nairobi South", employeeCode: "570", employeeName: "Goretty Wanga" },
  { teamLeader: "Benson Mbivi", subRegion: "Nairobi South", employeeCode: "1202", employeeName: "Grace Guanya" },
  { teamLeader: "Benson Mbivi", subRegion: "Nairobi South", employeeCode: "1032", employeeName: "James Ndambuki" }, // file said 1028; recoded to 1032, see header comment
  { teamLeader: "Benson Mbivi", subRegion: "Nairobi South", employeeCode: "747", employeeName: "James Owino" },
  { teamLeader: "Benson Mbivi", subRegion: "Nairobi South", employeeCode: "721", employeeName: "Michael Njuguna" },
  { teamLeader: "Benson Mbivi", subRegion: "Nairobi South", employeeCode: "1102", employeeName: "Robert Ouko" },
  { teamLeader: "Benson Mbivi", subRegion: "Nairobi South", employeeCode: "1191", employeeName: "Shumi Achieng" },
  { teamLeader: "Benson Mbivi", subRegion: "Nairobi South", employeeCode: "1027", employeeName: "Victor Chege" },

  { teamLeader: "Lewis Muthomi", subRegion: "Nairobi Metro", employeeCode: "1232", employeeName: "Brenda Bosibori" },
  { teamLeader: "Lewis Muthomi", subRegion: "Nairobi Metro", employeeCode: "1157", employeeName: "Caroline Wanjiru" },
  { teamLeader: "Lewis Muthomi", subRegion: "Nairobi Metro", employeeCode: "902", employeeName: "Dennis Thala" },
  { teamLeader: "Lewis Muthomi", subRegion: "Nairobi Metro", employeeCode: "1193", employeeName: "Gillian Muhambe" },
  { teamLeader: "Lewis Muthomi", subRegion: "Nairobi Metro", employeeCode: "1039", employeeName: "Hiram Michuki" },
  { teamLeader: "Lewis Muthomi", subRegion: "Nairobi Metro", employeeCode: "979", employeeName: "Joseph Maina" },
  { teamLeader: "Lewis Muthomi", subRegion: "Nairobi Metro", employeeCode: "1008", employeeName: "Meshack Mwendwa" },
  { teamLeader: "Lewis Muthomi", subRegion: "Nairobi Metro", employeeCode: "1110", employeeName: "Naomi Kinuthia" },
  { teamLeader: "Lewis Muthomi", subRegion: "Nairobi Metro", employeeCode: "1133", employeeName: "Samuel Mboya" },
  { teamLeader: "Lewis Muthomi", subRegion: "Nairobi Metro", employeeCode: "736", employeeName: "Savali Musau" },
  { teamLeader: "Lewis Muthomi", subRegion: "Nairobi Metro", employeeCode: "1108", employeeName: "Scolastica Mkacharo" },
  { teamLeader: "Lewis Muthomi", subRegion: "Nairobi Metro", employeeCode: "909", employeeName: "Scovian Achieng" },
  { teamLeader: "Lewis Muthomi", subRegion: "Nairobi Metro", employeeCode: "543", employeeName: "Stella Moraa" },
  { teamLeader: "Lewis Muthomi", subRegion: "Nairobi Metro", employeeCode: "968", employeeName: "Veronica Wambua" },
  { teamLeader: "Lewis Muthomi", subRegion: "Nairobi Metro", employeeCode: "1023", employeeName: "Vollenter Wendy" },
];

async function run(tx: Prisma.TransactionClient) {
  const codes = new Set(ROWS.map((r) => r.employeeCode));
  if (codes.size !== ROWS.length) throw new Error("Duplicate employee code in ROWS.");

  const teamLeaderNames = [...new Set(ROWS.map((r) => r.teamLeader))];
  const teamLeaders = await tx.teamLeader.findMany({ where: { name: { in: teamLeaderNames } } });
  const tlByName = new Map(teamLeaders.map((t) => [t.name, t]));
  for (const name of teamLeaderNames) if (!tlByName.has(name)) throw new Error(`Team Leader "${name}" not found.`);

  log("\n1. Realign the listed reps");
  let created = 0;
  let moved = 0;
  let updatedInPlace = 0;
  let alreadyCorrect = 0;
  let duplicatesFolded = 0;
  for (const row of ROWS) {
    const target = tlByName.get(row.teamLeader)!;
    const existingRows = await tx.teamLeaderAssignment.findMany({ where: { employeeCode: row.employeeCode, principal: MARS_PRINCIPAL } });
    const already = existingRows.find((a) => a.teamLeaderId === target.id);
    const others = existingRows.filter((a) => a.teamLeaderId !== target.id);

    if (already) {
      const changes: string[] = [];
      const data: Record<string, unknown> = {};
      if (already.region !== "Nairobi" || already.subRegion !== row.subRegion) {
        data.region = "Nairobi";
        data.subRegion = row.subRegion;
        changes.push(`${already.region ?? "-"}/${already.subRegion ?? "-"} -> Nairobi/${row.subRegion}`);
      }
      if (!already.active) {
        data.active = true;
        changes.push("reactivated");
      }
      if (already.employeeName !== row.employeeName) {
        data.employeeName = row.employeeName;
        changes.push(`name -> ${row.employeeName}`);
      }
      if (already.supervisorId !== target.supervisorId) {
        data.supervisorId = target.supervisorId;
        changes.push("supervisor refreshed");
      }
      if (changes.length > 0) {
        await tx.teamLeaderAssignment.update({ where: { id: already.id }, data });
        await tx.teamLeaderAssignmentAuditLog.create({
          data: { userEmail: AUDIT_USER, action: "UPDATE", teamLeaderId: target.id, supervisorId: target.supervisorId, principal: MARS_PRINCIPAL, employeeCode: row.employeeCode, changes: { updated: { new: changes.join("; ") } } },
        });
        updatedInPlace++;
      } else {
        alreadyCorrect++;
      }
    } else if (others.length > 0) {
      const toMove = others.shift()!;
      await tx.teamLeaderAssignment.update({
        where: { id: toMove.id },
        data: { teamLeaderId: target.id, employeeName: row.employeeName, region: "Nairobi", subRegion: row.subRegion, active: true, supervisorId: target.supervisorId },
      });
      await tx.teamLeaderAssignmentAuditLog.create({
        data: {
          userEmail: AUDIT_USER,
          action: "UPDATE",
          teamLeaderId: target.id,
          supervisorId: target.supervisorId,
          principal: MARS_PRINCIPAL,
          employeeCode: row.employeeCode,
          changes: { teamLeaderId: { old: toMove.teamLeaderId, new: target.id }, subRegion: { old: toMove.subRegion, new: row.subRegion } },
        },
      });
      moved++;
    } else {
      await tx.teamLeaderAssignment.create({
        data: {
          teamLeaderId: target.id,
          employeeCode: row.employeeCode,
          employeeName: row.employeeName,
          sapName: row.employeeName,
          principal: MARS_PRINCIPAL,
          absolutePrincipal: MARS_PRINCIPAL,
          active: true,
          salesRole: "PRIMARY",
          region: "Nairobi",
          subRegion: row.subRegion,
          supervisorId: target.supervisorId,
        },
      });
      await tx.teamLeaderAssignmentAuditLog.create({
        data: { userEmail: AUDIT_USER, action: "CREATE", teamLeaderId: target.id, supervisorId: target.supervisorId, principal: MARS_PRINCIPAL, employeeCode: row.employeeCode, changes: { created: { new: `${row.employeeName}, Nairobi/${row.subRegion}` } } },
      });
      created++;
    }

    // Fold away any leftover duplicate Mars-Nairobi row under a different Team Leader now that this rep's real row is settled.
    for (const dup of others) {
      await tx.teamLeaderAssignment.delete({ where: { id: dup.id } });
      await tx.teamLeaderAssignmentAuditLog.create({
        data: { userEmail: AUDIT_USER, action: "DELETE", teamLeaderId: dup.teamLeaderId, supervisorId: dup.supervisorId, principal: MARS_PRINCIPAL, employeeCode: row.employeeCode, changes: { removed: { old: `duplicate Mars-Nairobi row, kept the one now under ${row.teamLeader}`, new: null } } },
      });
      duplicatesFolded++;
    }

    // Keep EmployeeMaster's own "home" Team Leader in step - this is an authoritative move, not identity
    // resolution, so it overwrites rather than only filling a blank (see lib/employeeIdentity.ts's own rule).
    const employee = await tx.employeeMaster.findUnique({ where: { employeeCode: row.employeeCode } });
    if (employee && (employee.teamLeaderId !== target.id || employee.supervisorId !== target.supervisorId)) {
      await tx.employeeMaster.update({ where: { employeeCode: row.employeeCode }, data: { teamLeaderId: target.id, supervisorId: target.supervisorId } });
    }
  }
  log(`  ${created} created, ${moved} moved from another Team Leader, ${updatedInPlace} updated in place, ${alreadyCorrect} already correct, ${duplicatesFolded} duplicate(s) folded.`);

  log("\n2. Deactivate Nairobi Lower/Metro/South reps no longer on the list");
  const liveNairobi = await tx.teamLeaderAssignment.findMany({ where: { principal: MARS_PRINCIPAL, active: true, region: "Nairobi", subRegion: { in: NAIROBI_SUBREGIONS } } });
  const toDeactivate = liveNairobi.filter((a) => !codes.has(a.employeeCode));
  const holderIds = [...new Set(toDeactivate.map((a) => a.teamLeaderId))];
  const holderNameById = new Map((await tx.teamLeader.findMany({ where: { id: { in: holderIds } }, select: { id: true, name: true } })).map((t) => [t.id, t.name]));
  for (const a of toDeactivate) {
    await tx.teamLeaderAssignment.update({ where: { id: a.id }, data: { active: false } });
    await tx.teamLeaderAssignmentAuditLog.create({
      data: { userEmail: AUDIT_USER, action: "DEACTIVATE", teamLeaderId: a.teamLeaderId, supervisorId: a.supervisorId, principal: MARS_PRINCIPAL, employeeCode: a.employeeCode, changes: { active: { old: true, new: false } } },
    });
    log(`  deactivated ${a.employeeName} (${a.employeeCode}), was under ${holderNameById.get(a.teamLeaderId) ?? a.teamLeaderId} / ${a.subRegion}`);
  }
  log(`  ${toDeactivate.length} assignment(s) deactivated.`);

  log("\n3. Final headcount per Team Leader");
  for (const name of teamLeaderNames) {
    const tl = tlByName.get(name)!;
    const count = await tx.teamLeaderAssignment.count({ where: { teamLeaderId: tl.id, principal: MARS_PRINCIPAL, active: true } });
    log(`  ${name}: ${count} active (file lists ${ROWS.filter((r) => r.teamLeader === name).length})`);
  }

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
