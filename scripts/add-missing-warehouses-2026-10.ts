// One-off (October 2026): five SAP warehouses that sales are booked on but the Warehouse table does not list.
// An unlisted warehouse falls back to Nairobi in the sales sync, which put NYR007's EABL sales under EABL-Nyahururu instead of EABL-Nyeri
// and dropped the Bidco Nyeri warehouses' Suntory sales. Locations are the business's ruling of 19 Oct 2026.
//
//   node --import tsx scripts/add-missing-warehouses-2026-10.ts            DRY RUN: shows what it would add, changes nothing
//   node --import tsx scripts/add-missing-warehouses-2026-10.ts --apply    adds the missing rows
//
// Idempotent. A warehouse that already exists with a DIFFERENT location is reported and left alone (an --apply run stops), never overwritten.
import { prisma } from "../lib/db";

const apply = process.argv.includes("--apply");

// locationCode follows the existing table: 1 Nairobi, 2 Nyeri, 3 Nyahururu.
const WAREHOUSES = [
  { warehouseCode: "NYR007", warehouseName: "NYERI LOWER TOWN", location: "Nyeri", locationCode: "2" },
  { warehouseCode: "BID001", warehouseName: "BIDCO NYR MAIN WH", location: "Nyeri", locationCode: "2" },
  { warehouseCode: "BID002", warehouseName: "NYR BIDCO VAN", location: "Nyeri", locationCode: "2" },
  { warehouseCode: "MARS007", warehouseName: "MARS VAN 7 MLOLONGO PROBOX", location: "Nairobi", locationCode: "1" },
  { warehouseCode: "EABL16", warehouseName: "EABL NYH REP", location: "Nyahururu", locationCode: "3" },
];

async function main() {
  console.log(apply ? "APPLY: missing rows will be added." : "DRY RUN: nothing is changed.");
  const existing = await prisma.warehouse.findMany({ where: { warehouseCode: { in: WAREHOUSES.map((w) => w.warehouseCode) } } });
  const byCode = new Map(existing.map((w) => [w.warehouseCode, w]));
  const toCreate: typeof WAREHOUSES = [];
  let problems = 0;
  for (const w of WAREHOUSES) {
    const found = byCode.get(w.warehouseCode);
    if (!found) {
      toCreate.push(w);
      console.log(`  + ${w.warehouseCode} ${w.warehouseName} -> ${w.location}`);
    } else if (found.location !== w.location) {
      problems++;
      console.log(`  !! ${w.warehouseCode} already exists as ${found.location}, expected ${w.location}: left alone.`);
    } else {
      console.log(`  = ${w.warehouseCode} already ${found.location}.`);
    }
  }
  if (problems > 0 && apply) throw new Error(`${problems} problem(s); nothing was changed.`);
  if (apply && toCreate.length > 0) await prisma.warehouse.createMany({ data: toCreate });
  console.log(apply ? `Added ${toCreate.length}.` : `Would add ${toCreate.length}. Re-run with --apply to commit.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
