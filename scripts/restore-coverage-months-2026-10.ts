// One-off (19 Oct 2026): put January to April 2026's stored Coverage back as it was.
// The first customer-level backfill of the Coverage sync also rewrote CoverageActual for those four months from a fresh read of Pine, which moved
// the Coverage page's closed-month figures by about 1.5% (fewer principal/rep rows). The business wants closed months left as originally recorded.
//
//   node --import tsx scripts/restore-coverage-months-2026-10.ts <coverage-actual.copy>            DRY RUN: prints before/after, rolls back
//   node --import tsx scripts/restore-coverage-months-2026-10.ts <coverage-actual.copy> --apply    commits
//
// <coverage-actual.copy> is the CoverageActual data of the pre-backfill database dump, as COPY text:
//   pg_restore --data-only -t CoverageActual -f - <dump> > coverage-actual.copy
// The restore only proceeds when the dump's months equal the totals recorded just before the backfill (EXPECTED below), so a wrong or
// unexpected dump aborts. One transaction; idempotent (a second run finds the months already restored and changes nothing).
import { readFileSync } from "node:fs";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/db";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const file = args.find((a) => !a.startsWith("--"));
class DryRunRollback extends Error {}
const log = (message: string) => console.log(message);

const YEAR = "2026";
// [coverage, productive calls, rows] per monthIndex, read from CoverageActual immediately before the backfill.
const EXPECTED: Record<number, [number, number, number]> = {
  0: [43995, 36506, 148],
  1: [46452, 38090, 145],
  2: [49284, 41625, 146],
  3: [47679, 39542, 161],
};

interface DumpRow {
  id: string;
  year: string;
  month: string;
  monthIndex: number;
  salesRole: string;
  employeeName: string;
  principal: string;
  coverage: number;
  productiveCalls: number;
  updatedAt: Date;
  createdAt: Date;
}

/** COPY text: tab-separated, \N is NULL, backslash escapes. */
function unescapeCopy(value: string): string | null {
  if (value === "\\N") return null;
  return value.replace(/\\([\\tnr])/g, (_m, c: string) => (c === "t" ? "\t" : c === "n" ? "\n" : c === "r" ? "\r" : "\\"));
}

function parseCoverageCopy(text: string): DumpRow[] {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^COPY public\."CoverageActual" \(/.test(l));
  if (start < 0) throw new Error('No COPY block for "CoverageActual" in the file.');
  const columns = lines[start].replace(/^COPY public\."CoverageActual" \(/, "").replace(/\) FROM stdin;.*$/, "").split(",").map((c) => c.trim().replace(/"/g, ""));
  const rows: DumpRow[] = [];
  for (let i = start + 1; i < lines.length && lines[i] !== "\\."; i++) {
    const cells = lines[i].split("\t").map(unescapeCopy);
    const get = (name: string) => cells[columns.indexOf(name)];
    const num = (name: string) => Number(get(name));
    rows.push({
      id: String(get("id")),
      year: String(get("year")),
      month: String(get("month")),
      monthIndex: num("monthIndex"),
      salesRole: String(get("salesRole")),
      employeeName: String(get("employeeName")),
      principal: String(get("principal")),
      coverage: num("coverage"),
      productiveCalls: num("productiveCalls"),
      updatedAt: new Date(String(get("updatedAt")).replace(" ", "T") + "Z"),
      createdAt: new Date(String(get("createdAt")).replace(" ", "T") + "Z"),
    });
  }
  return rows;
}

const sums = (rows: { coverage: number; productiveCalls: number }[]) => [rows.reduce((s, r) => s + r.coverage, 0), rows.reduce((s, r) => s + r.productiveCalls, 0), rows.length] as const;

async function run(tx: Prisma.TransactionClient, dump: DumpRow[]) {
  for (const monthIndex of Object.keys(EXPECTED).map(Number)) {
    const original = dump.filter((r) => r.year === YEAR && r.monthIndex === monthIndex);
    const [cov, prod, count] = sums(original);
    const [eCov, eProd, eCount] = EXPECTED[monthIndex];
    if (cov !== eCov || prod !== eProd || count !== eCount) {
      throw new Error(`Month ${monthIndex + 1}: the dump has ${cov}/${prod}/${count} (coverage/productive/rows), expected ${eCov}/${eProd}/${eCount}. Wrong dump; nothing was changed.`);
    }
    const current = await tx.coverageActual.findMany({ where: { year: YEAR, monthIndex }, select: { coverage: true, productiveCalls: true } });
    const [nCov, nProd, nCount] = sums(current);
    log(`  ${original[0]?.month ?? monthIndex + 1}: now ${nCov}/${nProd}/${nCount}, restored to ${cov}/${prod}/${count}${nCov === cov && nProd === prod && nCount === count ? " (already restored)" : ""}.`);
    await tx.coverageActual.deleteMany({ where: { year: YEAR, monthIndex } });
    await tx.coverageActual.createMany({ data: original });
  }
  if (!apply) throw new DryRunRollback();
}

async function main() {
  if (!file) throw new Error("Give the COPY file: node --import tsx scripts/restore-coverage-months-2026-10.ts <coverage-actual.copy> [--apply]");
  log(apply ? "APPLY: changes will be committed." : "DRY RUN: everything is rolled back at the end.");
  const dump = parseCoverageCopy(readFileSync(file, "utf8"));
  log(`Read ${dump.length} CoverageActual rows from the dump.`);
  try {
    await prisma.$transaction((tx) => run(tx, dump), { timeout: 120_000, maxWait: 30_000 });
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error;
    log("\nDRY RUN finished and rolled back. Re-run with --apply to commit.");
    return;
  }
  log("\nRestored. The dashboard's in-memory dataset refreshes within five minutes.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
