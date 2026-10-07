// Rows for the Stock Balance Excel extract. Unlike the operational Stock Balance screen, the extract lists
// EVERY SKU the business holds a record of: those with stock, plus the zero-stock SKUs that have not sold in
// three months (which the screen leaves out). Each SKU and each principal is marked Active or dormant, and the
// period of inactivity is spelled out: from the day after the last sale to the date of the stock snapshot.
//
//  - SKU status: Active when the item was invoiced in the last three months (the same window that makes a
//    zero-stock item dormant in the stock sync), otherwise Dormant, including items never invoiced.
//  - Principal status: Active / Inactive, from classifyDormantPrincipals (an admin flag, or no sales in three
//    months), so it agrees with the Stock Balance screen.
//  - Principal dormancy period: for a flagged principal, from the date an admin recorded; for a principal that is
//    dormant only because it has not sold, from the day after its last sale.
import { aggregateStockByPrincipal, classifyDormantPrincipals } from "./stock";
import type { Dataset } from "./types";

export type ExtractCell = string | number;

export const STOCK_EXTRACT_ITEM_COLUMNS = [
  "Principal",
  "Principal Status",
  "Principal Dormancy Period",
  "Principal Last Sale",
  "Item",
  "Item Code",
  "SKU Status",
  "Last Sale Date",
  "Days Since Last Sale",
  "SKU Inactivity Period",
  "Opening Pcs",
  "Opening Value",
  "RR Week Value",
  "Days Cover",
  "Action",
];

export const STOCK_EXTRACT_PRINCIPAL_COLUMNS = [
  "Principal",
  "Principal Status",
  "Principal Dormancy Period",
  "Principal Last Sale",
  "SKUs",
  "Active SKUs",
  "Dormant SKUs",
  "Opening Value",
  "Opening Volume",
  "RR Week Value",
  "Days Cover",
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_MS = 86_400_000;

const utcMidnight = (iso: string): number => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);

/** "2026-03-14" -> "14 Mar 2026". */
export function formatExtractDate(iso: string): string {
  const date = new Date(utcMidnight(iso));
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** Whole days from `fromIso` to `toIso` (never negative). */
export function daysBetween(fromIso: string, toIso: string): number {
  return Math.max(0, Math.round((utcMidnight(toIso) - utcMidnight(fromIso)) / DAY_MS));
}

function addDays(iso: string, days: number): string {
  return new Date(utcMidnight(iso) + days * DAY_MS).toISOString().slice(0, 10);
}

/** The same calendar window the stock sync uses to call a zero-stock item dormant: three months back. */
export function activeSaleCutoff(asOfIso: string): string {
  const date = new Date(utcMidnight(asOfIso));
  date.setUTCMonth(date.getUTCMonth() - 3);
  return date.toISOString().slice(0, 10);
}

/** "15 Mar 2026 – 7 Oct 2026 (206 days)": from the day after `lastActiveIso` to the as-of date. */
export function inactivityPeriod(lastActiveIso: string, asOfIso: string): string {
  const days = daysBetween(lastActiveIso, asOfIso);
  return `${formatExtractDate(addDays(lastActiveIso, 1))} – ${formatExtractDate(asOfIso)} (${days} day${days === 1 ? "" : "s"})`;
}

interface ExtractSku {
  principal: string;
  key: string;
  item: string;
  itemCode: string;
  pcs: number;
  value: number;
  rrWeekValue: number;
  daysCover: number | "";
  action: string;
  /** undefined: the stock source does not carry sale dates (legacy snapshot); null: never invoiced. */
  lastSaleDate: string | null | undefined;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

export interface StockExtract {
  itemRows: ExtractCell[][];
  principalRows: ExtractCell[][];
  /** SKUs listed, how many are active, and how many are dormant (by their own sale dates). */
  skuCounts: { total: number; active: number; dormant: number };
  asOf: string;
}

export function buildStockExtract(dataset: Dataset, options: { brandKey?: string | null; asOf?: Date } = {}): StockExtract {
  const asOf = (options.asOf ?? (dataset.stockSource?.sourceDate ? new Date(dataset.stockSource.sourceDate) : new Date())).toISOString().slice(0, 10);
  const cutoff = activeSaleCutoff(asOf);
  const inBrand = (key: string) => !options.brandKey || key === options.brandKey;

  const skus: ExtractSku[] = [
    ...dataset.stockItems
      .filter((item) => inBrand(item.key))
      .map((item) => ({
        principal: item.principal,
        key: item.key,
        item: item.item,
        itemCode: item.itemCode ?? "",
        pcs: item.openingPcs,
        value: item.openingValue,
        rrWeekValue: item.rrWeekValue,
        daysCover: item.daysCover,
        action: item.action,
        lastSaleDate: item.lastSaleDate,
      })),
    ...(dataset.dormantStockItems ?? [])
      .filter((item) => inBrand(item.key))
      .map((item) => ({
        principal: item.principal,
        key: item.key,
        item: item.item,
        itemCode: item.itemCode,
        pcs: item.openingPcs,
        value: item.openingValue,
        rrWeekValue: 0,
        daysCover: "" as const,
        action: "Dormant – out of stock, no sale in 3 months",
        lastSaleDate: item.lastSaleDate,
      })),
  ];

  // Principal classification covers every brand that appears in either list (a brand with only zero-stock SKUs
  // still needs a status), and uses the dataset's own flags so it matches the Stock Balance screen.
  const brandKeys = Array.from(new Set(skus.map((sku) => sku.key)));
  const { dormantKeys, flaggedKeys } = classifyDormantPrincipals(dataset, brandKeys);
  const lastSaleByBrand = new Map<string, string>();
  for (const sku of skus) {
    if (sku.lastSaleDate && (!lastSaleByBrand.has(sku.key) || sku.lastSaleDate > lastSaleByBrand.get(sku.key)!)) lastSaleByBrand.set(sku.key, sku.lastSaleDate);
  }

  const principalPeriod = (key: string): string => {
    if (!dormantKeys.has(key)) return "";
    if (flaggedKeys.has(key)) {
      const since = dataset.dormantPrincipalSince?.[key];
      if (!since) return "Marked dormant (start date not recorded)";
      const days = daysBetween(since, asOf);
      return `${formatExtractDate(since)} – ${formatExtractDate(asOf)} (${days} day${days === 1 ? "" : "s"})`;
    }
    const lastSale = lastSaleByBrand.get(key);
    return lastSale ? inactivityPeriod(lastSale, asOf) : "No sales on record";
  };

  // SKU status is "Active" when invoiced since the cutoff; "Dormant" otherwise (never invoiced included);
  // blank only when the source carries no sale dates at all.
  const skuStatus = (sku: ExtractSku): "Active" | "Dormant" | "" => (sku.lastSaleDate === undefined ? "" : sku.lastSaleDate && sku.lastSaleDate >= cutoff ? "Active" : "Dormant");

  const principalStatus = (key: string) => (dormantKeys.has(key) ? "Inactive" : "Active");
  const ordered = [...skus].sort((a, b) => {
    const byPrincipalStatus = Number(dormantKeys.has(a.key)) - Number(dormantKeys.has(b.key));
    if (byPrincipalStatus !== 0) return byPrincipalStatus;
    const byPrincipal = a.principal.localeCompare(b.principal);
    if (byPrincipal !== 0) return byPrincipal;
    const bySku = Number(skuStatus(a) === "Dormant") - Number(skuStatus(b) === "Dormant");
    if (bySku !== 0) return bySku;
    return b.value - a.value || a.item.localeCompare(b.item);
  });

  const itemRows: ExtractCell[][] = ordered.map((sku) => {
    const status = skuStatus(sku);
    const lastSale = sku.lastSaleDate;
    const days = lastSale ? daysBetween(lastSale, asOf) : "";
    let period = "";
    if (status === "Dormant") period = lastSale ? inactivityPeriod(lastSale, asOf) : "Never sold (no invoice on record)";
    return [
      sku.principal,
      principalStatus(sku.key),
      principalPeriod(sku.key),
      lastSaleByBrand.get(sku.key) ? formatExtractDate(lastSaleByBrand.get(sku.key)!) : "",
      sku.item,
      sku.itemCode,
      status,
      lastSale ? formatExtractDate(lastSale) : "",
      days,
      period,
      round2(sku.pcs),
      round2(sku.value),
      round2(sku.rrWeekValue),
      sku.daysCover === "" ? "" : round2(sku.daysCover),
      sku.action,
    ];
  });

  // By-principal sheet: stock figures come from the stocked SKUs (zero-stock SKUs add nothing to them).
  const rollups = new Map(aggregateStockByPrincipal({ ...dataset, stockItems: dataset.stockItems.filter((item) => inBrand(item.key)) }).map((r) => [r.key, r]));
  const perBrand = new Map<string, { name: string; skus: number; active: number; dormant: number }>();
  for (const sku of skus) {
    const entry = perBrand.get(sku.key) ?? { name: sku.principal.split("-")[0].trim(), skus: 0, active: 0, dormant: 0 };
    entry.skus += 1;
    const status = skuStatus(sku);
    if (status === "Active") entry.active += 1;
    else if (status === "Dormant") entry.dormant += 1;
    perBrand.set(sku.key, entry);
  }
  const principalRows: ExtractCell[][] = Array.from(perBrand.entries())
    .sort(([keyA, a], [keyB, b]) => Number(dormantKeys.has(keyA)) - Number(dormantKeys.has(keyB)) || (rollups.get(keyB)?.value ?? 0) - (rollups.get(keyA)?.value ?? 0) || a.name.localeCompare(b.name))
    .map(([key, entry]) => {
      const rollup = rollups.get(key);
      return [
        entry.name,
        principalStatus(key),
        principalPeriod(key),
        lastSaleByBrand.get(key) ? formatExtractDate(lastSaleByBrand.get(key)!) : "",
        entry.skus,
        entry.active,
        entry.dormant,
        round2(rollup?.value ?? 0),
        round2(rollup?.volume ?? 0),
        round2(rollup?.rrWeekValue ?? 0),
        round2(rollup?.daysStock ?? 0),
      ];
    });

  let active = 0;
  let dormant = 0;
  for (const sku of skus) {
    const status = skuStatus(sku);
    if (status === "Active") active += 1;
    else if (status === "Dormant") dormant += 1;
  }
  return { itemRows, principalRows, skuCounts: { total: skus.length, active, dormant }, asOf };
}
