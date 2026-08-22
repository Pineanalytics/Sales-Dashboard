import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import sql from "mssql";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Real-time pull replacement for the SAP vendor's old CSV-drop workflow.
 *
 * Previously: a daily SQL query was run by hand against PinefrostAnalytics,
 * exported to CSV, and dropped in a shared folder the vendor's own scheduler
 * polled to push into SAP. That's inherently batch (only as fresh as the last
 * export run) and hands the vendor a flat file instead of typed data.
 *
 * This endpoint runs the exact same query — same columns, same string
 * formatting (FORMAT/CONVERT) so downstream parsing on their side doesn't
 * need to change — live against Transactions.Sales, on whatever cadence the
 * vendor's own scheduler wants to call it. No SQL Server credentials leave
 * Pinefrost; auth is a single shared key, same pattern as the Coaching
 * reference bridge (app/api/integrations/coaching/reference/route.ts).
 */

const MAX_ROWS = 50_000; // a single day of Transactions.Sales is nowhere near this; it's a safety cap, not an expected ceiling.

function hasValidKey(request: NextRequest) {
  const expected = process.env.SAP_SALES_EXPORT_KEY;
  const provided = request.headers.get("x-sap-sales-key");
  if (!expected || !provided) return false;
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);
}

function isValidDate(value: string | null): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function todayNairobi(): string {
  // Africa/Nairobi has no DST — a fixed UTC+3 offset is safe here.
  const now = new Date(Date.now() + 3 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. Configure the EABL SQL Server read-only connection.`);
  return value;
}

let pool: sql.ConnectionPool | null = null;
let pending: Promise<sql.ConnectionPool> | null = null;

/** Lazily-initialized, reused across requests — this route lives inside the
 *  long-running Next.js server, unlike the one-shot db-bridge scripts that
 *  open and close a pool per run. */
async function getPool(): Promise<sql.ConnectionPool> {
  if (pool?.connected) return pool;
  if (!pending) {
    pending = new sql.ConnectionPool({
      server: required("EABL_CALL_SQL_SERVER"),
      port: Number(process.env.EABL_CALL_SQL_PORT ?? 1433),
      database: required("EABL_CALL_SQL_DATABASE"),
      user: required("EABL_CALL_SQL_USER"),
      password: required("EABL_CALL_SQL_PASSWORD"),
      connectionTimeout: 15_000,
      requestTimeout: 60_000,
      options: {
        encrypt: (process.env.EABL_CALL_SQL_ENCRYPT ?? "false") === "true",
        trustServerCertificate: (process.env.EABL_CALL_SQL_TRUST_SERVER_CERT ?? "true") === "true",
      },
    }).connect();
  }
  pool = await pending;
  pending = null;
  return pool;
}

interface SapSalesRow {
  Distributor: string | null;
  CustomerCode: string | null;
  CustomerName: string | null;
  TransactionType: string | null;
  TransactionNumber: string | null;
  CashBillReference: string | null;
  ProductCode: string | null;
  TransactionDate: string;
  Salesman: string | null;
  SalesmanOperationType: string | null;
  SellingType: string | null;
  ExportDate: string | null;
  ProductHierarchyLevel4: string | null;
  CustomerStatus: string | null;
  ConversionUnit: string | null;
  UnitPrice: string | null;
  NetPrice: string | null;
  DiscountAmount: string | null;
  DiscountPercent: string | null;
  Tax: number | null;
  Quantity: number | null;
  UOM: string | null;
}

const CSV_COLUMNS: (keyof SapSalesRow)[] = [
  "Distributor", "CustomerCode", "CustomerName", "TransactionType", "TransactionNumber", "CashBillReference",
  "ProductCode", "TransactionDate", "Salesman", "SalesmanOperationType", "SellingType", "ExportDate",
  "ProductHierarchyLevel4", "CustomerStatus", "ConversionUnit", "UnitPrice", "NetPrice", "DiscountAmount",
  "DiscountPercent", "Tax", "Quantity", "UOM",
];

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function toCsv(rows: SapSalesRow[]): string {
  const header = CSV_COLUMNS.join(",");
  const lines = rows.map((row) => CSV_COLUMNS.map((col) => csvEscape(row[col])).join(","));
  return [header, ...lines].join("\r\n");
}

export async function GET(request: NextRequest) {
  if (!hasValidKey(request)) {
    return NextResponse.json({ error: "Invalid SAP sales export credentials." }, { status: 401 });
  }

  const url = new URL(request.url);
  const startDateParam = url.searchParams.get("startDate");
  const endDateParam = url.searchParams.get("endDate");
  const startDate = isValidDate(startDateParam) ? startDateParam : todayNairobi();
  const endDate = isValidDate(endDateParam) ? endDateParam : startDate;
  const format = url.searchParams.get("format") === "csv" ? "csv" : "json";

  let connectedPool: sql.ConnectionPool;
  try {
    connectedPool = await getPool();
  } catch (error) {
    console.error("[sap-sales-export] Failed to connect to SQL Server:", error);
    return NextResponse.json({ error: "Could not reach the source database." }, { status: 502 });
  }

  const result = await connectedPool
    .request()
    .input("startDate", sql.Date, startDate)
    .input("endDate", sql.Date, endDate)
    .query<SapSalesRow>(`
      SELECT TOP (${MAX_ROWS})
        s.Distributor,
        s.CustomerCode,
        s.CustomerName,
        s.TransactionType,
        s.TransactionNumber,
        s.CashBillReference,
        CASE WHEN s.ProductCode LIKE 'B%' THEN SUBSTRING(s.ProductCode, 2, LEN(s.ProductCode) - 1) ELSE s.ProductCode END AS ProductCode,
        CONVERT(VARCHAR(8), s.TransactionDate, 112) AS TransactionDate,
        s.Salesman,
        s.SalesmanOperationType,
        s.SellingType,
        CONVERT(VARCHAR(8), s.ExportDate, 112) AS ExportDate,
        s.ProductHierarchyLevel4,
        s.CustomerStatus,
        s.ConversionUnit,
        FORMAT(s.UnitPrice, '0.##############') AS UnitPrice,
        FORMAT(s.NetPrice, '#,##0.00') AS NetPrice,
        FORMAT(s.DiscountAmount, '#,##0.00') AS DiscountAmount,
        FORMAT(s.DiscountPercent, '0.00') + '%' AS DiscountPercent,
        s.Tax,
        s.Quantity,
        s.UOM
      FROM Transactions.Sales s
      WHERE s.TransactionDate >= @startDate
        AND s.TransactionDate < DATEADD(DAY, 1, @endDate)
        AND s.UOM <> 'PC'
      ORDER BY s.TransactionDate, s.CustomerCode, s.TransactionNumber
    `);

  const rows = result.recordset;

  if (format === "csv") {
    return new NextResponse(toCsv(rows), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  return NextResponse.json(
    { syncedAt: new Date().toISOString(), startDate, endDate, rowCount: rows.length, truncated: rows.length >= MAX_ROWS, rows },
    { headers: { "Cache-Control": "no-store" } }
  );
}
