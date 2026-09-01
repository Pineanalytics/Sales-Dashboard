import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import sql from "mssql";
import { contentRevision, eablFilename, parseIsoDate, toHeaderlessCsv } from "@/lib/eablSalesExport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ROWS = 50_000;

function hasValidKey(request: NextRequest): boolean {
  const expected = process.env.EABL_SALES_EXPORT_KEY;
  const supplied = request.headers.get("x-eabl-sales-export-key");
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

let pool: sql.ConnectionPool | null = null;
let connecting: Promise<sql.ConnectionPool> | null = null;
async function getPool(): Promise<sql.ConnectionPool> {
  if (pool?.connected) return pool;
  if (!connecting) {
    connecting = new sql.ConnectionPool({
      server: required("EABL_CALL_SQL_SERVER"), port: Number(process.env.EABL_CALL_SQL_PORT ?? 1433),
      database: required("EABL_CALL_SQL_DATABASE"), user: required("EABL_CALL_SQL_USER"),
      password: required("EABL_CALL_SQL_PASSWORD"), connectionTimeout: 15_000, requestTimeout: 60_000,
      options: { encrypt: process.env.EABL_CALL_SQL_ENCRYPT === "true", trustServerCertificate: process.env.EABL_CALL_SQL_TRUST_SERVER_CERT !== "false" },
    }).connect();
  }
  try { pool = await connecting; return pool; } finally { connecting = null; }
}

async function readDay(date: string): Promise<Record<string, unknown>[]> {
  const result = await (await getPool()).request().input("startDate", sql.Date, date).query<Record<string, unknown>>(`
    SELECT TOP (${MAX_ROWS + 1})
      s.Distributor, s.CustomerCode, s.CustomerName, s.TransactionType, s.TransactionNumber, s.CashBillReference,
      s.ProductCode, s.TransactionDate, s.Salesman, s.SalesmanOperationType, s.SellingType, s.ExportDate,
      s.ProductHierarchyLevel4, s.CustomerStatus, s.ConversionUnit, s.UnitPrice, s.NetPrice, s.DiscountAmount,
      s.DiscountPercent, s.Tax, s.Quantity, s.UOM
    FROM Transactions.Sales s
    WHERE s.TransactionDate >= @startDate AND s.TransactionDate < DATEADD(DAY, 1, @startDate) AND s.UOM <> 'PC'
    ORDER BY s.TransactionDate, s.CustomerCode, s.TransactionNumber
  `);
  if (result.recordset.length > MAX_ROWS) throw new RangeError(`More than ${MAX_ROWS} qualifying rows exist for this date.`);
  return result.recordset;
}

function datesInclusive(from: string, to: string): string[] {
  const start = new Date(`${from}T00:00:00.000Z`); const end = new Date(`${to}T00:00:00.000Z`);
  const count = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (count < 1 || count > 2) throw new RangeError("Manifest requests may contain one or two dates only.");
  return Array.from({ length: count }, (_, i) => new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10));
}

export async function GET(request: NextRequest) {
  if (!hasValidKey(request)) return NextResponse.json({ error: "Invalid export credentials." }, { status: 401 });
  const url = new URL(request.url);
  try {
    if (url.searchParams.get("mode") === "manifest") {
      const from = parseIsoDate(url.searchParams.get("from")); const to = parseIsoDate(url.searchParams.get("to"));
      if (!from || !to) return NextResponse.json({ error: '"from" and "to" must be real YYYY-MM-DD dates.' }, { status: 400 });
      const days = await Promise.all(datesInclusive(from, to).map(async (date) => {
        const rows = await readDay(date); const csv = toHeaderlessCsv(rows);
        return { date, rowCount: rows.length, revision: contentRevision(csv), latestRelevantUpdateAt: rows.length ? date : null, lastReplacementAt: null };
      }));
      return NextResponse.json({ report: "eabl-sales-export", days, generatedAt: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
    }
    const date = parseIsoDate(url.searchParams.get("date"));
    if (!date) return NextResponse.json({ error: '"date" must be a real YYYY-MM-DD date.' }, { status: 400 });
    const rows = await readDay(date);
    if (!rows.length) return NextResponse.json({ error: "No qualifying sales rows for the requested date." }, { status: 404 });
    const csv = toHeaderlessCsv(rows);
    return new NextResponse(csv, { headers: {
      "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${eablFilename(date)}"`,
      "Cache-Control": "no-store", "X-Report-Row-Count": String(rows.length), "X-Report-Revision": contentRevision(csv),
    } });
  } catch (error) {
    if (error instanceof RangeError) return NextResponse.json({ error: error.message }, { status: 413 });
    console.error("[eabl-sales-export] source query failed", error);
    return NextResponse.json({ error: "Could not read the source report." }, { status: 502 });
  }
}
