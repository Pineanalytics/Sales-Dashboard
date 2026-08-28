import * as XLSX from "xlsx";

export class ProductsParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductsParseError";
  }
}

export interface ParsedProductRow {
  itemNo: string;
  itemDescription: string | null;
  series: string | null;
  size: string | null;
  packSize: number | null;
  principal: string;
  costPrice: number | null;
  classification: string | null;
  ssuConversion: number | null;
}

function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

function headerKey(value: unknown): string {
  return text(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function nullableText(value: unknown): string | null {
  return text(value) || null;
}

function nullableNumber(value: unknown, column: string, rowNumber: number): number | null {
  const raw = text(value);
  if (!raw) return null;
  const parsed = typeof value === "number" ? value : Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(parsed)) {
    throw new ProductsParseError(`Row ${rowNumber} has an invalid ${column} value: "${raw}".`);
  }
  return parsed;
}

const COLUMNS = {
  itemNo: ["itemno", "itemnumber", "productcode", "sapcode"],
  itemDescription: ["itemdescription", "description", "productdescription"],
  series: ["series"],
  size: ["size"],
  packSize: ["packsize"],
  principal: ["principal", "mainprincipal"],
  costPrice: ["costprice"],
  classification: ["classification", "class"],
  ssuConversion: ["ssuconversion", "ssuconv"],
} as const;

function findColumn(headers: string[], names: readonly string[]): number {
  return headers.findIndex((header) => names.includes(header));
}

export function parseProductsWorkbook(buffer: ArrayBuffer): ParsedProductRow[] {
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheetName = workbook.SheetNames.includes("Products") ? "Products" : workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new ProductsParseError("The uploaded workbook does not contain a worksheet.");

  const values = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true }) as unknown[][];
  const headerRowIndex = values.slice(0, 10).findIndex((row) => {
    const headers = row.map(headerKey);
    return findColumn(headers, COLUMNS.itemNo) >= 0 && findColumn(headers, COLUMNS.principal) >= 0;
  });
  if (headerRowIndex < 0) {
    throw new ProductsParseError(`Sheet "${sheetName}" must contain Item No. and Principal columns.`);
  }

  const headers = values[headerRowIndex].map(headerKey);
  const indexes = Object.fromEntries(
    Object.entries(COLUMNS).map(([name, aliases]) => [name, findColumn(headers, aliases)])
  ) as Record<keyof typeof COLUMNS, number>;

  const parsed: ParsedProductRow[] = [];
  const seen = new Set<string>();
  for (let index = headerRowIndex + 1; index < values.length; index += 1) {
    const row = values[index] ?? [];
    if (row.every((value) => !text(value))) continue;

    const rowNumber = index + 1;
    const itemNo = text(row[indexes.itemNo]);
    const principal = text(row[indexes.principal]);
    if (!itemNo) throw new ProductsParseError(`Row ${rowNumber} is missing Item No.`);
    if (!principal) throw new ProductsParseError(`Row ${rowNumber} (${itemNo}) is missing Principal.`);
    if (seen.has(itemNo)) throw new ProductsParseError(`Item No. "${itemNo}" appears more than once in sheet "${sheetName}".`);
    seen.add(itemNo);

    const value = (column: keyof typeof COLUMNS) => indexes[column] >= 0 ? row[indexes[column]] : null;
    parsed.push({
      itemNo,
      itemDescription: nullableText(value("itemDescription")),
      series: nullableText(value("series")),
      size: nullableText(value("size")),
      packSize: nullableNumber(value("packSize"), "Pack size", rowNumber),
      principal,
      costPrice: nullableNumber(value("costPrice"), "Cost Price", rowNumber),
      classification: nullableText(value("classification")),
      ssuConversion: nullableNumber(value("ssuConversion"), "SSU Conversion", rowNumber),
    });
  }

  if (parsed.length === 0) throw new ProductsParseError(`Sheet "${sheetName}" contains no product rows.`);
  return parsed;
}
