import { createHash } from "node:crypto";

export const EABL_SALES_EXPORT_COLUMNS = [
  "Distributor", "CustomerCode", "CustomerName", "TransactionType", "TransactionNumber", "CashBillReference",
  "ProductCode", "TransactionDate", "Salesman", "SalesmanOperationType", "SellingType", "ExportDate",
  "ProductHierarchyLevel4", "CustomerStatus", "ConversionUnit", "UnitPrice", "NetPrice", "DiscountAmount",
  "DiscountPercent", "Tax", "Quantity", "UOM",
] as const;

export type EablSalesExportColumn = (typeof EABL_SALES_EXPORT_COLUMNS)[number];
export type EablSalesExportRow = Record<EablSalesExportColumn, unknown>;

export function parseIsoDate(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value ? null : value;
}

export function toCompactDate(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "string" && /^\d{8}$/.test(value)) return value;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;
}

function decimal(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? String(number) : null;
}

export function formatUnitPrice(value: unknown): string {
  const raw = decimal(value);
  if (raw === null) return "";
  // SQL numeric values arrive as JS numbers. Trim only insignificant zeros;
  // do not use locale formatting, because commas are data delimiters here.
  return raw.includes(".") ? raw.replace(/(?:\.0+|(\.\d*?)0+)$/, "$1") : raw;
}

export function formatFixed(value: unknown, places: number): string {
  const raw = decimal(value);
  return raw === null ? "" : Number(raw).toFixed(places);
}

export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// Known data-quality exceptions in the source system: a handful of per-bottle
// SKUs were assigned an unrelated "B"-prefixed code instead of following the
// normal convention (B + the item's own official/base code). The generic
// B-strip in resolveProductCode() below reproduces that convention correctly
// for every product that follows it - this map corrects the ones that don't, keyed by
// the code AFTER stripping the "B" prefix, so the extraction is right even if
// the source system's own master data is never corrected upstream. Confirmed
// 2026-09-03: source ProductCode "B696894" should resolve to "616838" (its
// official code), not "696894" - add further exceptions here as they surface,
// one line each, with the date and who/what confirmed it.
const KNOWN_PRODUCT_CODE_CORRECTIONS: Record<string, string> = {
  "696894": "616838", // per-bottle SKU mis-coded upstream; confirmed 2026-09-03
};

function resolveProductCode(rawCode: string): string {
  const stripped = rawCode.startsWith("B") ? rawCode.slice(1) : rawCode;
  return KNOWN_PRODUCT_CODE_CORRECTIONS[stripped] ?? stripped;
}

// NetPrice arrives from the source VAT-inclusive; the receiving system
// expects a VAT-exclusive figure instead. Kenyan VAT is a flat 16%. Confirmed
// 2026-09-04: the source's Tax column is not a usable per-row taxed/exempt
// indicator (no distinct 0/1 - or any other - split was found in it), so this
// is applied uniformly to every row rather than conditioned on Tax.
const KENYA_VAT_RATE = 0.16;

function excludeVat(value: unknown): number | null {
  const raw = decimal(value);
  return raw === null ? null : Number(raw) / (1 + KENYA_VAT_RATE);
}

export function normaliseRow(row: Record<string, unknown>): EablSalesExportRow {
  const productCode = row.ProductCode == null ? "" : String(row.ProductCode);
  return {
    Distributor: row.Distributor,
    CustomerCode: row.CustomerCode,
    CustomerName: row.CustomerName,
    TransactionType: row.TransactionType,
    TransactionNumber: row.TransactionNumber,
    CashBillReference: row.CashBillReference,
    ProductCode: resolveProductCode(productCode),
    TransactionDate: toCompactDate(row.TransactionDate),
    Salesman: row.Salesman,
    SalesmanOperationType: row.SalesmanOperationType,
    SellingType: row.SellingType,
    ExportDate: toCompactDate(row.ExportDate),
    ProductHierarchyLevel4: row.ProductHierarchyLevel4,
    CustomerStatus: row.CustomerStatus,
    ConversionUnit: row.ConversionUnit,
    UnitPrice: formatUnitPrice(row.UnitPrice),
    NetPrice: formatFixed(excludeVat(row.NetPrice), 2),
    DiscountAmount: formatFixed(row.DiscountAmount, 2),
    DiscountPercent: row.DiscountPercent === null || row.DiscountPercent === undefined || row.DiscountPercent === "" ? "" : `${formatFixed(row.DiscountPercent, 2)}%`,
    Tax: row.Tax,
    Quantity: row.Quantity,
    UOM: row.UOM,
  };
}

/** The receiving contract is explicitly headerless. */
export function toHeaderlessCsv(rows: Record<string, unknown>[]): string {
  return rows.map((raw) => {
    const row = normaliseRow(raw);
    return EABL_SALES_EXPORT_COLUMNS.map((column) => csvEscape(row[column])).join(",");
  }).join("\r\n");
}

export function contentRevision(csv: string): string {
  return createHash("sha256").update(csv, "utf8").digest("hex");
}

export function eablFilename(date: string): string {
  return `EABL_${date.replaceAll("-", "")}.csv`;
}
