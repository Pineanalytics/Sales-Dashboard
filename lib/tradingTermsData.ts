// Database reads for the Trading terms report (lib/tradingTerms.ts). A year is about a million invoice lines, so they are
// added up in the database. Principals travel as one array value, which keeps each statement the same from run to run.
import { prisma } from "@/lib/db";
import type { TermAccount, TermCustomerRow, TermMonthRow } from "@/lib/tradingTerms";

const day = (year: number, monthIndex: number) => new Date(Date.UTC(year, monthIndex, 1)).toISOString().slice(0, 10);
const monthStart = (month: string) => day(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1);
const nextMonthStart = (month: string) => day(Number(month.slice(0, 4)), Number(month.slice(5, 7)));

/** Net sales of the months `from` to `to` (YYYY-MM, both included), by month and by customer. */
export async function loadTermSales(from: string, to: string, principals: string[]): Promise<{ monthRows: TermMonthRow[]; customerRows: TermCustomerRow[] }> {
  if (principals.length === 0) return { monthRows: [], customerRows: [] };
  const start = monthStart(from);
  const end = nextMonthStart(to);
  const [monthRows, customerRows] = await Promise.all([
    prisma.$queryRaw<TermMonthRow[]>`
      SELECT principal, to_char("docDate", 'YYYY-MM') AS month, "paymentTerm", MAX("paymentTermDays")::int AS "paymentTermDays",
             SUM("salesAmount")::float8 AS sales
      FROM "SalesLine"
      WHERE "docDate" >= ${start}::date AND "docDate" < ${end}::date AND principal = ANY(${principals})
      GROUP BY 1, 2, 3`,
    prisma.$queryRaw<TermCustomerRow[]>`
      SELECT principal, "sfaName", "customerName", "cardCode", "paymentTerm", MAX("paymentTermDays")::int AS "paymentTermDays",
             SUM("salesAmount")::float8 AS sales,
             (COUNT(DISTINCT "docEntry") FILTER (WHERE "docType" = 'INVOICE'))::int AS invoices,
             COALESCE(SUM("salesAmount") FILTER (WHERE "docType" = 'INVOICE' AND "dueDate" IS NOT NULL), 0)::float8 AS "datedValue",
             COALESCE(SUM("salesAmount" * ("dueDate" - "docDate")) FILTER (WHERE "docType" = 'INVOICE' AND "dueDate" IS NOT NULL), 0)::float8 AS "dayValue",
             to_char(MAX("docDate") FILTER (WHERE "docType" = 'INVOICE'), 'YYYY-MM-DD') AS "lastInvoice"
      FROM "SalesLine"
      WHERE "docDate" >= ${start}::date AND "docDate" < ${end}::date AND principal = ANY(${principals})
      GROUP BY principal, "sfaName", "customerName", "cardCode", "paymentTerm"`,
  ]);
  return { monthRows, customerRows };
}

/** Each SAP account's term, credit limit and open balance today, and when the receivables sync read them. */
export async function loadTermAccounts(): Promise<{ accounts: Map<string, TermAccount>; asOf: Date | null }> {
  const [latest, profiles, owed] = await Promise.all([
    prisma.receivablesSyncRun.findFirst({ orderBy: { completedAt: "desc" }, select: { sourceDate: true } }),
    prisma.customerCreditProfile.findMany({ select: { customerCode: true, creditLimit: true, creditTerm: { select: { name: true } } } }),
    prisma.receivableOpenItem.groupBy({ by: ["customerCode"], _sum: { openBalance: true } }),
  ]);
  const owedByCode = new Map(owed.map((row) => [row.customerCode, row._sum.openBalance ?? 0]));
  const accounts = new Map<string, TermAccount>(
    profiles.map((row) => [row.customerCode, { term: row.creditTerm?.name ?? null, creditLimit: row.creditLimit, outstanding: owedByCode.get(row.customerCode) ?? 0 }])
  );
  return { accounts, asOf: latest?.sourceDate ?? null };
}
