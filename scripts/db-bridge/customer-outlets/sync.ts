// Links SAP invoice references to SFA outlets (InvoiceOutlet), so the Customer analysis can show channel, segment and
// territory. Reads the references of the stored invoice lines (SalesLine), looks the new ones up in the system that raised
// them (see lib/invoiceReferences.ts) and saves reference -> outlet. Read-only against Pine and EABL DMS; Upfield and
// Leverage need no outside read.
//
//   npm run customer-outlets:sync                                current month
//   npm run customer-outlets:sync -- --months=2                  current + previous month
//   npm run customer-outlets:sync -- --from=2026-01 --to=2026-06
//   npm run customer-outlets:sync -- --dry-run [...]             look up and report, save nothing
//
// Run daily for the last 2 months by the outlets-sync-worker, after the evening invoice-line sync.
try {
  process.loadEnvFile(process.env.CUSTOMER_OUTLETS_ENV_FILE ?? ".env");
} catch {
  // env vars may already be provided by the container
}

import { Prisma } from "@prisma/client";
import { prisma } from "../../../lib/db";
import { normalizeReference, parseInvoiceReference } from "../../../lib/invoiceReferences";
import { fromEabl, fromPine, type Wanted } from "./lookups";
import { monthRange } from "../sfa/monthRange";
import { sfaMonthLabel, type SfaMonth } from "../sfa/syncMonth";

const CHUNK = 5000;
const DAY_MS = 86_400_000;
/** An order can be raised some weeks before SAP invoices it. */
const LOOK_BACK_DAYS = 31;
const LOOK_AHEAD_DAYS = 7;

interface Link {
  ref: string;
  source: string;
  outletKey: string;
}

const chunks = <T,>(values: T[]): T[][] => Array.from({ length: Math.ceil(values.length / CHUNK) }, (_, i) => values.slice(i * CHUNK, (i + 1) * CHUNK));

function want(wanted: Wanted, key: string, ref: string) {
  const refs = wanted.get(key);
  if (refs) refs.push(ref);
  else wanted.set(key, [ref]);
}

function linksFor(wanted: Wanted, source: string, found: Map<string, string>): Link[] {
  return [...found].flatMap(([key, outletKey]) => (wanted.get(key) ?? []).map((ref) => ({ ref, source, outletKey })));
}

/** The references on the month's stored lines that are not linked yet. */
async function newReferences(month: SfaMonth): Promise<string[]> {
  const start = new Date(Date.UTC(month.year, month.monthIndex, 1));
  const end = new Date(Date.UTC(month.year, month.monthIndex + 1, 1));
  const rows = await prisma.$queryRaw<{ ref: string }[]>(Prisma.sql`
    SELECT DISTINCT UPPER(BTRIM("numAtCard")) AS ref FROM "SalesLine"
    WHERE "docDate" >= ${start} AND "docDate" < ${end} AND "numAtCard" IS NOT NULL AND BTRIM("numAtCard") <> ''`);
  const refs = rows.map((row) => row.ref);
  const known = new Set<string>();
  for (const part of chunks(refs)) {
    for (const row of await prisma.invoiceOutlet.findMany({ where: { ref: { in: part } }, select: { ref: true } })) known.add(row.ref);
  }
  return refs.filter((ref) => !known.has(ref));
}

async function fromUpfield(wanted: Wanted): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  for (const part of chunks([...wanted.keys()])) {
    const rows = await prisma.upfieldTransaction.findMany({ where: { invoiceNo: { in: part } }, select: { invoiceNo: true, custCode: true }, distinct: ["invoiceNo"] });
    for (const row of rows) if (row.custCode?.trim()) found.set(normalizeReference(row.invoiceNo), row.custCode.trim());
  }
  return found;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  let failures = 0;
  for (const month of monthRange(args, new Date())) {
    const refs = await newReferences(month);
    const upfield: Wanted = new Map();
    const orders: Wanted = new Map();
    const sales: Wanted = new Map();
    const eabl: Wanted = new Map();
    const links: Link[] = [];
    for (const ref of refs) {
      const parsed = parseInvoiceReference(ref);
      if (!parsed) continue;
      if (parsed.system === "LEVERAGE") links.push({ ref, source: "LEVERAGE", outletKey: parsed.outletKey });
      else want({ UPFIELD: upfield, PINE_ORDER: orders, PINE_SALE: sales, EABL: eabl }[parsed.system], parsed.key, ref);
    }
    const start = new Date(Date.UTC(month.year, month.monthIndex, 1) - LOOK_BACK_DAYS * DAY_MS);
    const end = new Date(Date.UTC(month.year, month.monthIndex + 1, 1) + LOOK_AHEAD_DAYS * DAY_MS);
    const lookups: [string, string, Wanted, () => Promise<Map<string, string>>][] = [
      ["Upfield DataEdge", "UPFIELD", upfield, () => fromUpfield(upfield)],
      ["Pine orders", "PINE", orders, () => fromPine("orders", orders, start, end)],
      ["Pine sales", "PINE", sales, () => fromPine("sales", sales, start, end)],
      ["EABL DMS", "EABL", eabl, () => fromEabl(eabl, start, end)],
    ];
    for (const [label, source, wanted, lookup] of lookups) {
      if (wanted.size === 0) continue;
      // One system being unreachable must not lose what the others found.
      try {
        const found = await lookup();
        links.push(...linksFor(wanted, source, found));
        console.log(`[customer-outlets] ${sfaMonthLabel(month)} ${label}: ${found.size} of ${wanted.size} references found.`);
      } catch (error) {
        failures += 1;
        console.error(`[customer-outlets] ${sfaMonthLabel(month)} ${label} failed:`, error);
      }
    }
    if (!dryRun) for (const part of chunks(links)) await prisma.invoiceOutlet.createMany({ data: part, skipDuplicates: true });
    console.log(`[customer-outlets] ${sfaMonthLabel(month)}: ${refs.length} new references, ${links.length} linked to an outlet${dryRun ? " (DRY RUN, nothing saved)" : ""}.`);
  }
  if (failures > 0) throw new Error(`${failures} lookup(s) failed; they are retried on the next run.`);
}

main()
  .catch((error) => {
    console.error("[customer-outlets] FAILED:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
