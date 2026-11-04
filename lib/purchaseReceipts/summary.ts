// The Purchases / stock-receipts report's numbers, from the receipt lines the SAP sync stores. Pure: no database. Values are KSh excl. VAT as SAP posted them to stock; returns and credits
// are negative, so "net" is simply the sum. Returnable-packaging warehouses (empties) are kept out of every headline figure and reported on their own line.
import { normalizePrincipalKey } from "@/lib/normalize";
import { DOC_TYPE_GROUP, RECEIPT_DOC_TYPES, type ReceiptDocType, type ReceiptGroup, type StockClass } from "./types";

export interface ReceiptLine {
  year: number;
  monthIndex: number;
  docDate: string;
  docType: ReceiptDocType;
  docEntry: number;
  docNum: string;
  supplierCode: string;
  supplierName: string;
  itemCode: string;
  itemName: string;
  warehouseCode: string;
  location: string;
  principal: string;
  principalSource: "PRODUCT" | "PREFIX" | "UNALLOCATED";
  stockClass: StockClass;
  qty: number;
  cases: number;
  value: number;
}

export interface MonthRef {
  year: number;
  monthIndex: number;
}

/** Value (KSh) and cases by what the movement was: receipts from suppliers, returns and credits back to them, and the smaller adjustments. */
export interface Amounts {
  receipts: number;
  returns: number;
  other: number;
  net: number;
  receiptCases: number;
  returnCases: number;
  netCases: number;
}

const emptyAmounts = (): Amounts => ({ receipts: 0, returns: 0, other: 0, net: 0, receiptCases: 0, returnCases: 0, netCases: 0 });

function add(into: Amounts, line: Pick<ReceiptLine, "docType" | "value" | "cases">): void {
  const group: ReceiptGroup = DOC_TYPE_GROUP[line.docType];
  if (group === "RECEIPT") {
    into.receipts += line.value;
    into.receiptCases += line.cases;
  } else if (group === "RETURN") {
    into.returns += line.value;
    into.returnCases += line.cases;
  } else {
    into.other += line.value;
  }
  into.net += line.value;
  into.netCases += line.cases;
}

export interface Row extends Amounts {
  key: string;
  label: string;
  /** Distinct documents behind the row. */
  docs: number;
}

export interface PurchaseSummary {
  months: MonthRef[];
  /** Saleable goods only: empties are on their own line. */
  totals: Amounts & { docs: number; lines: number; suppliers: number };
  empties: Amounts & { lines: number };
  byDocType: { docType: ReceiptDocType; docs: number; cases: number; value: number }[];
  byPrincipal: Row[];
  /** The same principals with their locations rolled together (EABL-Nyeri + EABL-Nyahururu = EABL). */
  byBrand: Row[];
  bySupplier: Row[];
  byWarehouse: (Row & { location: string })[];
  byMonth: (Amounts & { year: number; monthIndex: number; docs: number })[];
  /** Net value by principal for each month of the period, in the order of `months`. */
  monthlyByPrincipal: { principal: string; months: number[]; total: number }[];
  topItems: (Amounts & { itemCode: string; itemName: string; principal: string })[];
  /** Lines whose item is on no principal's list: their value is in the totals but under "Unallocated". */
  unallocated: { lines: number; value: number };
  /** Lines with a quantity but no pack size on the Product master, so their cases read 0. */
  noPackSize: { lines: number; items: number };
}

const brandOf = (principal: string) => principal.split("-")[0].trim() || principal;

interface Bucket<T extends object> {
  amounts: Amounts;
  docs: Set<string>;
  meta: T;
}

function bucketize<T extends object>(lines: ReceiptLine[], keyOf: (l: ReceiptLine) => string, metaOf: (l: ReceiptLine) => T): Map<string, Bucket<T>> {
  const map = new Map<string, Bucket<T>>();
  for (const line of lines) {
    const key = keyOf(line);
    let bucket = map.get(key);
    if (!bucket) {
      bucket = { amounts: emptyAmounts(), docs: new Set(), meta: metaOf(line) };
      map.set(key, bucket);
    }
    add(bucket.amounts, line);
    bucket.docs.add(`${line.docType}|${line.docEntry}`);
  }
  return map;
}

const byNetDesc = <T extends { net: number }>(a: T, b: T) => b.net - a.net;
const monthKey = (m: MonthRef) => `${m.year}|${m.monthIndex}`;

/** `principalKey` is the dashboard's brand key ("eabl"); null means every principal. Lines outside `months` are ignored. */
export function buildPurchaseSummary(lines: ReceiptLine[], months: MonthRef[], principalKey: string | null): PurchaseSummary {
  const inScope = new Set(months.map(monthKey));
  const wanted = lines.filter((l) => inScope.has(monthKey(l)) && (!principalKey || normalizePrincipalKey(l.principal) === principalKey));
  const goods = wanted.filter((l) => l.stockClass === "GOODS");
  const empties = wanted.filter((l) => l.stockClass === "EMPTIES");

  const totalAmounts = emptyAmounts();
  const totalDocs = new Set<string>();
  const totalSuppliers = new Set<string>();
  for (const l of goods) {
    add(totalAmounts, l);
    totalDocs.add(`${l.docType}|${l.docEntry}`);
    totalSuppliers.add(l.supplierCode);
  }
  const emptiesAmounts = emptyAmounts();
  for (const l of empties) add(emptiesAmounts, l);

  const toRow = <T extends object>(map: Map<string, Bucket<T>>, label: (key: string, meta: T) => string): (Row & T)[] =>
    [...map.entries()].map(([key, b]) => ({ ...b.meta, ...b.amounts, key, label: label(key, b.meta), docs: b.docs.size })).sort(byNetDesc);

  const byPrincipal = toRow(bucketize(goods, (l) => l.principal, () => ({})), (key) => key);
  const byBrand = toRow(bucketize(goods, (l) => normalizePrincipalKey(l.principal), (l) => ({ brand: brandOf(l.principal) })), (_key, meta) => meta.brand);
  const bySupplier = toRow(bucketize(goods, (l) => l.supplierCode, (l) => ({ name: l.supplierName })), (key, meta) => `${meta.name} (${key})`);
  const byWarehouse = toRow(bucketize(goods, (l) => l.warehouseCode, (l) => ({ location: l.location })), (key) => key);

  const byMonth = months.map((m) => {
    const of = goods.filter((l) => l.year === m.year && l.monthIndex === m.monthIndex);
    const amounts = emptyAmounts();
    for (const l of of) add(amounts, l);
    return { year: m.year, monthIndex: m.monthIndex, ...amounts, docs: new Set(of.map((l) => `${l.docType}|${l.docEntry}`)).size };
  });

  const principals = new Map<string, number[]>();
  for (const l of goods) {
    const at = months.findIndex((m) => m.year === l.year && m.monthIndex === l.monthIndex);
    if (at < 0) continue;
    const row = principals.get(l.principal) ?? months.map(() => 0);
    row[at] += l.value;
    principals.set(l.principal, row);
  }
  const monthlyByPrincipal = [...principals.entries()].map(([principal, values]) => ({ principal, months: values, total: values.reduce((s, v) => s + v, 0) })).sort((a, b) => b.total - a.total);

  const itemBuckets = bucketize(goods, (l) => `${l.itemCode}|${l.principal}`, (l) => ({ itemCode: l.itemCode, itemName: l.itemName, principal: l.principal }));
  const topItems = [...itemBuckets.values()].map((b) => ({ ...b.meta, ...b.amounts })).sort(byNetDesc).slice(0, 100);

  const byDocType = RECEIPT_DOC_TYPES.map((docType) => {
    const of = goods.filter((l) => l.docType === docType);
    return { docType, docs: new Set(of.map((l) => l.docEntry)).size, cases: of.reduce((s, l) => s + l.cases, 0), value: of.reduce((s, l) => s + l.value, 0) };
  }).filter((r) => r.docs > 0);

  const unallocated = goods.filter((l) => l.principalSource === "UNALLOCATED");
  const noPack = goods.filter((l) => l.qty !== 0 && l.cases === 0);

  return {
    months,
    totals: { ...totalAmounts, docs: totalDocs.size, lines: goods.length, suppliers: totalSuppliers.size },
    empties: { ...emptiesAmounts, lines: empties.length },
    byDocType,
    byPrincipal,
    byBrand,
    bySupplier,
    byWarehouse,
    byMonth,
    monthlyByPrincipal,
    topItems,
    unallocated: { lines: unallocated.length, value: unallocated.reduce((s, l) => s + l.value, 0) },
    noPackSize: { lines: noPack.length, items: new Set(noPack.map((l) => l.itemCode)).size },
  };
}

/** The months of the period that have no receipt line at all, so the report can say they were not loaded rather than show zero. */
export function monthsWithoutData(lines: Pick<ReceiptLine, "year" | "monthIndex">[], months: MonthRef[]): MonthRef[] {
  const have = new Set(lines.map(monthKey));
  return months.filter((m) => !have.has(monthKey(m)));
}
