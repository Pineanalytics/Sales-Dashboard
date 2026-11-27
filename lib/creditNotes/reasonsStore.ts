// Database reads for the credit-note reasons (lib/creditNotes/reasons.ts). They come from the SAP document lines kept for the
// Customer extract (SalesLine), which carry each document's Remarks, number and author; the lines are added up to one row per
// credit note and principal in the database. Principals are named and scoped as in the rest of the Credit Notes report.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizePrincipalKey } from "@/lib/normalize";
import { buildReasonReport, type ReasonReport, type ReasonRow } from "./reasons";
import { lineInScope, type LineScope } from "./scope";

export interface ReasonRequest {
  /** YYYY-MM months of the selected period. */
  months: string[];
  /** Selected principal keys (normalizePrincipalKey form); empty = all the viewer may see. */
  principalKeys: string[];
  /** Free-text narrowing across customer, item, rep, principal and branch. */
  query?: string;
  /** The viewer's data scope, null when unrestricted. */
  scope: LineScope | null;
  /** Full-length lists, for the Excel export. */
  full?: boolean;
}

export interface ReasonResult {
  /** Null when the selected months hold no credit notes for this selection. */
  report: ReasonReport | null;
  /** Selected months whose invoice lines are not stored, so their reasons cannot be shown. */
  missingMonths: string[];
  /** When the oldest of the stored months was last read from SAP. */
  dataAsOf: string | null;
}

interface StoredRow {
  docEntry: number;
  docNum: string;
  date: string;
  customerCode: string;
  customerName: string;
  rep: string;
  principal: string;
  enteredBy: string | null;
  remarks: string | null;
  sales: number;
}

const monthStart = (year: number, monthIndex: number) => new Date(Date.UTC(year, monthIndex, 1)).toISOString().slice(0, 10);
const parts = (month: string) => [Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1] as const;

/** Brand-level principal for each active branch principal, as the Performance Analysis lines name them. */
async function principalBrands(): Promise<Map<string, string>> {
  const rows = await prisma.principal.findMany({ where: { status: "Active" }, select: { principal: true, mainPrincipal: true } });
  return new Map(
    rows.map((row) => {
      const brand = (row.mainPrincipal || row.principal).trim();
      return [row.principal, brand.toLowerCase() === "eabl" ? "EABL" : brand];
    })
  );
}

export async function buildCreditNoteReasons(request: ReasonRequest): Promise<ReasonResult> {
  const months = Array.from(new Set(request.months)).sort();
  if (months.length === 0) return { report: null, missingMonths: [], dataAsOf: null };

  const loaded = await prisma.salesLineMonth.findMany({
    where: { OR: months.map((month) => ({ year: String(parts(month)[0]), monthIndex: parts(month)[1] })) },
    select: { year: true, monthIndex: true, syncedAt: true },
  });
  const held = new Set(loaded.map((row) => `${row.year}-${String(row.monthIndex + 1).padStart(2, "0")}`));
  const missingMonths = months.filter((month) => !held.has(month));
  const oldest = loaded.reduce<Date | null>((min, row) => (min === null || row.syncedAt < min ? row.syncedAt : min), null);
  const dataAsOf = oldest ? oldest.toISOString() : null;
  const heldMonths = months.filter((month) => held.has(month));
  if (heldMonths.length === 0) return { report: null, missingMonths, dataAsOf };

  const start = monthStart(...parts(heldMonths[0]));
  const [lastYear, lastIndex] = parts(heldMonths[heldMonths.length - 1]);
  const end = monthStart(lastYear, lastIndex + 1);
  // The search narrows lines exactly as the rest of the report does. One statement shape, with or without a search.
  const needle = (request.query ?? "").trim();
  const pattern = `%${needle.replace(/[\\%_]/g, "\\$&")}%`;
  const search = needle
    ? Prisma.sql`AND (s."cardCode" ILIKE ${pattern} OR s."customerName" ILIKE ${pattern} OR s."itemCode" ILIKE ${pattern} OR s."itemName" ILIKE ${pattern}
        OR s."salesEmployee" ILIKE ${pattern} OR s.principal ILIKE ${pattern} OR s."whsName" ILIKE ${pattern} OR s."whsCode" ILIKE ${pattern})`
    : Prisma.empty;

  const [brands, stored] = await Promise.all([
    principalBrands(),
    prisma.$queryRaw<StoredRow[]>`
      SELECT s."docEntry", s."docNum", to_char(s."docDate", 'YYYY-MM-DD') AS date, s."cardCode" AS "customerCode", MAX(s."customerName") AS "customerName",
             MAX(s."salesEmployee") AS rep, s.principal, MAX(s."createdBy") AS "enteredBy", MAX(s.remarks) AS remarks,
             SUM(s."salesAmount")::float8 AS sales
      FROM "SalesLine" s
      WHERE s."docType" = 'CREDIT_NOTE' AND s."docDate" >= ${start}::date AND s."docDate" < ${end}::date
        AND to_char(s."docDate", 'YYYY-MM') = ANY(${heldMonths}) ${search}
      GROUP BY s."docEntry", s."docNum", s."docDate", s."cardCode", s.principal`,
  ]);

  const wanted = new Set(request.principalKeys.map((key) => normalizePrincipalKey(key)).filter(Boolean));
  const rows: ReasonRow[] = [];
  for (const row of stored) {
    // A line under no active principal is left out, as in the report's other figures.
    const principal = brands.get(row.principal);
    if (!principal) continue;
    if (wanted.size > 0 && !wanted.has(normalizePrincipalKey(principal))) continue;
    if (!lineInScope({ principal, rep: row.rep }, request.scope)) continue;
    rows.push({
      docEntry: row.docEntry,
      docNum: row.docNum,
      date: row.date,
      customerCode: row.customerCode,
      customerName: row.customerName,
      rep: row.rep,
      principal,
      enteredBy: row.enteredBy ?? "(Not recorded)",
      remarks: row.remarks,
      credit: -row.sales,
    });
  }
  if (rows.length === 0) return { report: null, missingMonths, dataAsOf };

  const report = buildReasonReport(rows, { months: heldMonths, ...(request.full ? { topCustomers: Infinity, documentsPerReason: Infinity } : {}) });
  return { report: report.total.documents > 0 ? report : null, missingMonths, dataAsOf };
}
