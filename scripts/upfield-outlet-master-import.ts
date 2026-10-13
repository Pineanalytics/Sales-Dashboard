// Loads Upfield's outlet list (customer master) from the DataEdge export on disk.
//
//   npx tsx scripts/upfield-outlet-master-import.ts <file.xlsx>            DRY RUN: reads the file, prints what it holds and what would change
//   npx tsx scripts/upfield-outlet-master-import.ts <file.xlsx> --apply    replaces the whole master with it, then refreshes the Active Outlet universe
//
// The same parser and replace as the Admin > Upfield outlet list page (lib/upfieldOutletMaster.ts, lib/upfieldOutletMasterStore.ts).
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { prisma } from "../lib/db";
import { parseUpfieldOutletMaster, summarizeUpfieldOutletMaster } from "../lib/upfieldOutletMaster";
import { replaceUpfieldOutletMaster } from "../lib/upfieldOutletMasterStore";
import { rebuildOutletUniverse } from "../lib/outletUniverse/rebuild";

const file = process.argv[2];
const apply = process.argv.includes("--apply");

async function main() {
  if (!file || file.startsWith("--")) throw new Error("Usage: npx tsx scripts/upfield-outlet-master-import.ts <file.xlsx> [--apply]");
  const parsed = parseUpfieldOutletMaster(readFileSync(file));
  const summary = summarizeUpfieldOutletMaster(parsed.rows);
  console.log(`${apply ? "APPLY" : "DRY RUN"}: ${basename(file)} holds ${parsed.rows.length} outlets.`);
  for (const warning of parsed.warnings) console.log(`  note: ${warning}`);
  console.log(`  by channel: ${summary.byChannel.map(([name, n]) => `${name} ${n}`).join(", ")}`);
  console.log(`  by type: ${summary.byType.map(([name, n]) => `${name} ${n}`).join(", ")}`);
  console.log(`  by FSR: ${summary.byFsr.map(([name, n]) => `${name} ${n}`).join(", ")}`);

  const existing = await prisma.upfieldOutletMaster.findMany({ select: { outletCode: true } });
  const existingCodes = new Set(existing.map((row) => row.outletCode));
  const incoming = new Set(parsed.rows.map((row) => row.outletCode));
  console.log(`  current master: ${existing.length} outlets; the file adds ${[...incoming].filter((code) => !existingCodes.has(code)).length} and drops ${[...existingCodes].filter((code) => !incoming.has(code)).length}.`);

  if (!apply) {
    console.log("\nDRY RUN: nothing was changed. Re-run with --apply to replace the master.");
    return;
  }
  const stored = await replaceUpfieldOutletMaster(parsed.rows, { sourceFile: basename(file), uploadedBy: "import script" });
  console.log(`\nStored ${stored} outlets. Refreshing the Active Outlet universe...`);
  const result = await rebuildOutletUniverse();
  console.log(`Universe rebuilt: ${result.total} outlets (Upfield ${result.upfield}).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
