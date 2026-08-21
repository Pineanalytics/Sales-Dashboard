// Direct Mars actuals bridge.  Pine remains the operational source for this
// principal's SSU/cases/value KPIs; this worker normalises it to the approved
// Mars product master and fiscal calendar instead of waiting for an Excel
// export.  A full FY26 run is staged beside the workbook and activated
// only after every source window has uploaded successfully.
if (!process.env.PL_BRIDGE_APP_URL) process.loadEnvFile();

import { fetchFactLines, fetchNoSaleVisits, fetchOutlets, fetchProducts, fetchUsers, formatPineLocalDate, resolveNoSalesColumns, type FactLineRow, type NoSaleVisitRow } from "../active-outlets/query";
import { loadCoverageConfigFromEnv, withCoverageConnection } from "../coverage/mysql";

const DEFAULT_APP_URL = "https://pinefrostdb.com";
const BATCH_SIZE = 500;
const FULL_WINDOW_DAYS = 7;
const FULL_RESYNC_AFTER_HOURS = Number(process.env.MARS_KPIS_FULL_RESYNC_AFTER_HOURS ?? "22");

type NullableText = string | null;
interface Period { fiscalYear: string; periodKey: string; periodNo: number; startDate: string; endDate: string; }
interface Product { itemNo: string; itemName: string; packSize: number | null; brand: NullableText; classification: NullableText; ssuConversion: number | null; }
interface Roster { employeeCode: string; employeeName: string; employeeGroup: NullableText; location: NullableText; teamLeader: NullableText; fsr: NullableText; sellerType: NullableText; }
interface RtmCustomer { customerId: string; rtmType: NullableText; assignedRep: NullableText; }
interface SyncState { lastIncrementalAt: string | null; lastFullResyncAt: string | null; }
interface Reference { periods: Period[]; products: Product[]; roster: Roster[]; rtmCustomers: RtmCustomer[]; state: SyncState; }
interface SaleLineRow {
  sourceKey: string; fiscalYear: string; periodKey: string; periodNo: number; date: string;
  transactionType: "sale" | "sale_return" | "order" | "order_return" | "no_sale"; saleType: "Actual" | "Offers" | "Returns" | "No sale"; isReturn: boolean;
  employeeCode: NullableText; employeeName: NullableText; employeeGroup: NullableText; location: NullableText;
  teamLeader: NullableText; fsr: NullableText; sellerType: NullableText; customerId: string; customerName: NullableText;
  channel: NullableText; territory: NullableText; itemNo: NullableText; itemName: NullableText; brand: NullableText;
  classification: NullableText; rtmType: NullableText; rtmOwner: NullableText; qty: number; cases: number; ssu: number; revenue: number; invoiceNo: NullableText;
}

function chunks<T>(values: T[], size: number): T[][] { const result: T[][] = []; for (let i = 0; i < values.length; i += size) result.push(values.slice(i, i + size)); return result; }
function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function key(value: string | null | undefined) { return value?.trim().toUpperCase() ?? ""; }
function day(value: Date | string) { return typeof value === "string" ? value.slice(0, 10) : formatPineLocalDate(value); }
function utcDate(value: string) { return new Date(`${value}T00:00:00.000Z`); }

async function request(appUrl: string, apiKey: string, init?: RequestInit): Promise<Response> {
  return fetch(`${appUrl}/api/principal-kpis/mars/sync`, { ...init, headers: { "Content-Type": "application/json", "x-upload-api-key": apiKey, ...(init?.headers ?? {}) }, signal: AbortSignal.timeout(90_000) });
}
async function getReference(appUrl: string, apiKey: string): Promise<Reference> {
  const response = await request(appUrl, apiKey);
  const body = await response.text();
  if (!response.ok) throw new Error(`Mars reference request failed (${response.status}): ${body}`);
  return JSON.parse(body) as Reference;
}
async function post(appUrl: string, apiKey: string, body: unknown): Promise<void> {
  let lastError = "";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await request(appUrl, apiKey, { method: "POST", body: JSON.stringify(body) });
      const result = await response.text();
      if (response.ok) return;
      lastError = `${response.status}: ${result}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (attempt < 3) await sleep(attempt * 1_500);
  }
  throw new Error(`Mars bridge request failed after 3 attempts: ${lastError}`);
}
function windows(start: Date, end: Date): { start: Date; end: Date }[] {
  const result: { start: Date; end: Date }[] = [];
  for (let cursor = new Date(start); cursor < end;) {
    const next = new Date(Math.min(cursor.getTime() + FULL_WINDOW_DAYS * 86_400_000, end.getTime()));
    result.push({ start: cursor, end: next });
    cursor = next;
  }
  return result;
}
function periodForDate(periods: Period[], value: Date): Period | undefined {
  const valueDay = day(value);
  return periods.find((period) => valueDay >= day(period.startDate) && valueDay <= day(period.endDate));
}

function mapRows(
  lines: FactLineRow[], periods: Period[], marsProducts: Map<string, Product>, outlets: Map<string, { name: string; subChannel: string; territory: string }>, users: Map<string, { employee: string }>, roster: Map<string, Roster>, rtmCustomers: Map<string, RtmCustomer>
) {
  const result = new Map<string, SaleLineRow>();
  let matchingProductLines = 0;
  for (const line of lines) {
    const product = marsProducts.get(key(line.itemId));
    if (!product) continue;
    const period = periodForDate(periods, line.purchaseTime);
    if (!period) continue;
    matchingProductLines += 1;
    const transactionType = line.transactionType ?? (line.isOrder ? "order" : "sale");
    const sourceKey = `pine/${transactionType}/${line.docId}/${line.itemId}`;
    const qty = Number(line.qty);
    const isReturn = transactionType === "sale_return" || transactionType === "order_return";
    const saleType = isReturn ? "Returns" : Number(line.unitPrice) > 0 ? "Actual" : "Offers";
    const existing = result.get(sourceKey);
    if (existing) {
      existing.qty += qty;
      existing.cases += product.packSize && product.packSize > 0 ? qty / product.packSize : 0;
      existing.ssu += qty * (product.ssuConversion ?? 0);
      existing.revenue += qty * Number(line.unitPrice);
      continue;
    }
    const outlet = outlets.get(line.customerId);
    const rep = roster.get(line.userId);
    const sourceUser = users.get(line.userId);
    const rtm = rtmCustomers.get(line.customerId);
    result.set(sourceKey, {
      sourceKey, transactionType, saleType, isReturn, fiscalYear: period.fiscalYear, periodKey: period.periodKey, periodNo: period.periodNo, date: utcDate(day(line.purchaseTime)).toISOString(),
      employeeCode: rep?.employeeCode ?? line.userId, employeeName: rep?.employeeName ?? sourceUser?.employee ?? null,
      employeeGroup: rep?.employeeGroup ?? null, location: rep?.location ?? null, teamLeader: rep?.teamLeader ?? null, fsr: rep?.fsr ?? null, sellerType: rep?.sellerType ?? null,
      customerId: line.customerId, customerName: outlet?.name ?? null, channel: outlet?.subChannel ?? null, rtmType: rtm?.rtmType ?? null, rtmOwner: rtm?.assignedRep ?? null, territory: outlet?.territory ?? null,
      itemNo: product.itemNo, itemName: product.itemName, brand: product.brand, classification: product.classification,
      qty, cases: product.packSize && product.packSize > 0 ? qty / product.packSize : 0, ssu: qty * (product.ssuConversion ?? 0), revenue: qty * Number(line.unitPrice), invoiceNo: line.docId,
    });
  }
  return { rows: [...result.values()], matchingProductLines };
}

function mapNoSaleRows(
  visits: NoSaleVisitRow[], periods: Period[], outlets: Map<string, { name: string; subChannel: string; territory: string }>, users: Map<string, { employee: string }>, roster: Map<string, Roster>, rtmCustomers: Map<string, RtmCustomer>
) {
  const rows: SaleLineRow[] = [];
  for (const visit of visits) {
    const period = periodForDate(periods, visit.visitTime);
    if (!period) continue;
    const outlet = outlets.get(visit.customerId);
    const rep = roster.get(key(visit.userId));
    const sourceUser = users.get(visit.userId);
    const rtm = rtmCustomers.get(visit.customerId);
    rows.push({
      sourceKey: `pine/no_sale/${visit.visitId}`, transactionType: "no_sale", saleType: "No sale", isReturn: false,
      fiscalYear: period.fiscalYear, periodKey: period.periodKey, periodNo: period.periodNo, date: utcDate(day(visit.visitTime)).toISOString(),
      employeeCode: rep?.employeeCode ?? visit.userId, employeeName: rep?.employeeName ?? sourceUser?.employee ?? null,
      employeeGroup: rep?.employeeGroup ?? null, location: rep?.location ?? null, teamLeader: rep?.teamLeader ?? null, fsr: rep?.fsr ?? null, sellerType: rep?.sellerType ?? null,
      customerId: visit.customerId, customerName: outlet?.name ?? null, channel: outlet?.subChannel ?? null, rtmType: rtm?.rtmType ?? null, rtmOwner: rtm?.assignedRep ?? null, territory: outlet?.territory ?? null,
      itemNo: null, itemName: null, brand: null, classification: null, qty: 0, cases: 0, ssu: 0, revenue: 0, invoiceNo: visit.noSaleReason,
    });
  }
  return rows;
}

async function main() {
  const apiKey = process.env.UPLOAD_API_KEY;
  if (!apiKey) throw new Error("Missing UPLOAD_API_KEY in .sync.env.");
  const appUrl = process.env.PL_BRIDGE_APP_URL || DEFAULT_APP_URL;
  const reference = await getReference(appUrl, apiKey);
  const now = new Date();
  const today = day(now);
  const currentPeriod = reference.periods
    .filter((period) => today >= day(period.startDate) && today <= day(period.endDate))
    .sort((a, b) => Number(b.fiscalYear) - Number(a.fiscalYear))[0];
  if (!currentPeriod) throw new Error(`No Mars fiscal period covers ${today}. Refresh the approved Mars calendar before running this bridge.`);
  // Pine became Mars's SFA during FY25 P07. It is authoritative for live
  // FY26 actuals, while the supplied template remains the comparable FY25
  // baseline for the earlier transition periods.
  const selectedPeriods = reference.periods.filter((period) => period.fiscalYear === currentPeriod.fiscalYear && period.periodNo <= currentPeriod.periodNo);
  const hoursSinceFull = reference.state.lastFullResyncAt ? (now.getTime() - new Date(reference.state.lastFullResyncAt).getTime()) / 3_600_000 : Infinity;
  const full = hoursSinceFull >= FULL_RESYNC_AFTER_HOURS;
  const fetchPeriods = full ? selectedPeriods : selectedPeriods.filter((period) => period.periodNo === currentPeriod.periodNo);
  if (fetchPeriods.length === 0) throw new Error("Mars calendar has no selected source periods.");
  if (full) await post(appUrl, apiKey, { action: "begin-full" });

  const config = loadCoverageConfigFromEnv();
  const pineProducts = new Map<string, { sapCode: string }>();
  const productMap = new Map(reference.products.map((product) => [key(product.itemNo), product]));
  const outletMap = new Map<string, { name: string; subChannel: string; territory: string }>();
  const userMap = new Map<string, { employee: string }>();
  const rosterMap = new Map(reference.roster.map((rep) => [key(rep.employeeCode), rep]));
  const rtmCustomerMap = new Map(reference.rtmCustomers.map((customer) => [customer.customerId, customer]));
  let sourceLines = 0;
  let matchingProductLines = 0;
  let uploadedRows = 0;
  let newest = now;

  await withCoverageConnection(config, async (conn) => {
    const [outlets, users, products, noSaleColumns] = await Promise.all([fetchOutlets(conn), fetchUsers(conn), fetchProducts(conn), resolveNoSalesColumns(conn)]);
    for (const product of products) pineProducts.set(product.id, { sapCode: product.sapCode });
    for (const outlet of outlets) outletMap.set(outlet.id, { name: outlet.name, subChannel: outlet.subChannel, territory: outlet.territory });
    for (const user of users) userMap.set(user.id, { employee: user.employee });
    console.log(`[mars-kpis] Direct ${full ? "full" : "P09 incremental"} sync: ${fetchPeriods.length} fiscal period(s), ${products.length} Pine products, ${productMap.size} Mars product mappings.`);

    for (const period of fetchPeriods) {
      const start = utcDate(day(period.startDate));
      const scheduledEnd = new Date(utcDate(day(period.endDate)).getTime() + 86_400_000);
      const end = period.fiscalYear === currentPeriod.fiscalYear && period.periodNo === currentPeriod.periodNo ? now : scheduledEnd;
      if (start >= end) continue;
      for (const window of windows(start, end)) {
        const [facts, noSaleVisits] = await Promise.all([
          fetchFactLines(conn, window.start, window.end),
          noSaleColumns ? fetchNoSaleVisits(conn, noSaleColumns, window.start, window.end) : Promise.resolve([]),
        ]);
        sourceLines += facts.length;
        // Pine fact rows use numeric p_id; resolve that to p_skucode before
        // matching the Mars Product Master (Item No.).
        const marsFacts = facts.map((line) => ({ ...line, itemId: pineProducts.get(line.itemId)?.sapCode ?? "" }));
        const mapped = mapRows(marsFacts, fetchPeriods, productMap, outletMap, userMap, rosterMap, rtmCustomerMap);
        matchingProductLines += mapped.matchingProductLines;
        for (const line of facts) if (line.purchaseTime > newest) newest = line.purchaseTime;
        const rows = [...mapped.rows, ...mapNoSaleRows(noSaleVisits, fetchPeriods, outletMap, userMap, rosterMap, rtmCustomerMap)];
        for (const batch of chunks(rows, BATCH_SIZE)) {
          await post(appUrl, apiKey, { action: "rows", rows: batch });
          uploadedRows += batch.length;
        }
        console.log(`[mars-kpis] ${day(window.start)}–${day(new Date(window.end.getTime() - 1))}: ${facts.length} Pine lines, ${mapped.matchingProductLines} Mars lines, ${mapped.rows.length} ledger rows.`);
      }
    }
  });
  if (matchingProductLines === 0) throw new Error("No Pine product codes matched the Mars Product Master; keeping the workbook snapshot active.");
  await post(appUrl, apiKey, { action: full ? "complete-full" : "complete-incremental", lastIncrementalAt: newest.toISOString() });
  const coverage = sourceLines > 0 ? ((matchingProductLines / sourceLines) * 100).toFixed(2) : "0.00";
  console.log(`[mars-kpis] Complete: ${sourceLines} source lines, ${matchingProductLines} Mars-matched (${coverage}%), ${uploadedRows} uploaded rows; P${String(currentPeriod.periodNo).padStart(2, "0")} is current.`);
}

main().catch((error) => {
  console.error("[mars-kpis] FAILED:", error);
  process.exitCode = 1;
});
