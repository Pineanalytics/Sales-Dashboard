// Builds the SFA-outlet-grain tables (SalesDocument + SfaCustomerActual) from
// document-level SAP lines. Principal resolution deliberately mirrors the
// existing pipeline first (Product Master principal + warehouse location, with
// the same fixups) so these totals reconcile with BrandCustomerActual, and only
// falls back to the item-prefix rules where Product Master has no mapping —
// those lines are tagged PREFIX instead of being silently dropped.
import { allocatePrincipal, UNALLOCATED_PRINCIPAL } from "@/lib/principalRules";
import { resolveSfaCustomer, sfaCustomerKey } from "@/lib/sfaCustomer";
import type { SfaSalesLine } from "../queries/sfaSalesLines";
import type { ProductRow } from "../reference/loadFromDb";
import type { WarehouseRow } from "./buildMonthlySales";
import { applyFixups } from "./buildRepSales";

export type PrincipalSource = "PRODUCT" | "PREFIX" | "UNALLOCATED";

export interface SfaDocumentRow {
  docType: "INVOICE" | "CREDIT_NOTE";
  docNum: string;
  docDate: string;
  series: number | null;
  cardCode: string;
  accountName: string;
  sfaCustomer: string;
  sfaContact: string;
  sfaNameSource: "SFA" | "ACCOUNT";
  numAtCard: string | null;
  slpCode: number;
  repName: string;
  principal: string;
  principalSource: PrincipalSource;
  lineCount: number;
  cases: number;
  netSales: number;
  grossProfit: number;
  sapGrossProfit: number;
}

export interface SfaCustomerMonthlyRow {
  year: string;
  monthIndex: number;
  principal: string;
  cardCode: string;
  accountName: string;
  sfaCustomer: string;
  sfaContact: string;
  slpCode: number;
  repName: string;
  docCount: number;
  cases: number;
  revenue: number;
  grossProfit: number;
}

export interface SfaBuildStats {
  lines: number;
  documents: number;
  sfaNamedDocuments: number;
  accountFallbackDocuments: number;
  principalSalesBySource: Record<PrincipalSource, number>;
  unallocatedItems: { itemCode: string; itemName: string; sales: number }[];
}

export interface SfaBuildResult {
  documents: SfaDocumentRow[];
  monthlyRows: SfaCustomerMonthlyRow[];
  stats: SfaBuildStats;
}

function casesFrom(qty: number, packSize: number | null): number {
  return packSize && Number.isFinite(qty) ? qty / packSize : 0;
}

interface ResolvedLinePrincipal {
  principal: string;
  source: PrincipalSource;
}

function resolveLinePrincipal(
  line: SfaSalesLine,
  productByItemNo: Map<string, ProductRow>,
  warehouseByCode: Map<string, WarehouseRow>
): ResolvedLinePrincipal {
  const location = line.whsCode ? warehouseByCode.get(line.whsCode)?.location ?? "Nairobi" : "Nairobi";
  const product = productByItemNo.get(line.itemCode);
  const mapped = product?.principal?.trim();
  if (mapped) return { principal: applyFixups(`${mapped}-${location}`), source: "PRODUCT" };

  const allocation = allocatePrincipal(line.itemCode, line.itemName);
  if (allocation.rule) return { principal: applyFixups(`${allocation.principal}-${location}`), source: "PREFIX" };
  return { principal: UNALLOCATED_PRINCIPAL, source: "UNALLOCATED" };
}

export function buildSfaSales(lines: SfaSalesLine[], products: ProductRow[], warehouses: WarehouseRow[]): SfaBuildResult {
  const productByItemNo = new Map(products.map((p) => [p.itemNo, p]));
  const warehouseByCode = new Map(warehouses.map((w) => [w.warehouseCode, w]));

  interface DocAccumulator {
    row: SfaDocumentRow;
    salesByPrincipal: Map<string, { sales: number; source: PrincipalSource }>;
  }
  const docs = new Map<string, DocAccumulator>();
  const monthly = new Map<string, { row: SfaCustomerMonthlyRow; docs: Set<string> }>();
  const unallocated = new Map<string, { itemCode: string; itemName: string; sales: number }>();
  const salesBySource: Record<PrincipalSource, number> = { PRODUCT: 0, PREFIX: 0, UNALLOCATED: 0 };

  for (const line of lines) {
    const resolved = resolveLinePrincipal(line, productByItemNo, warehouseByCode);
    const customer = resolveSfaCustomer(line.sfaName, line.accountName);
    const cases = casesFrom(line.qty, line.packSize);
    const docKey = `${line.docType}|${line.docNum}`;

    salesBySource[resolved.source] += line.salesAmount;
    if (resolved.source === "UNALLOCATED") {
      const entry = unallocated.get(line.itemCode) ?? { itemCode: line.itemCode, itemName: line.itemName, sales: 0 };
      entry.sales += line.salesAmount;
      unallocated.set(line.itemCode, entry);
    }

    let doc = docs.get(docKey);
    if (!doc) {
      doc = {
        row: {
          docType: line.docType,
          docNum: line.docNum,
          docDate: line.docDate,
          series: line.series,
          cardCode: line.cardCode,
          accountName: line.accountName,
          sfaCustomer: customer.name,
          sfaContact: customer.contact,
          sfaNameSource: customer.source,
          numAtCard: line.numAtCard,
          slpCode: line.slpCode,
          repName: line.repName,
          principal: UNALLOCATED_PRINCIPAL,
          principalSource: "UNALLOCATED",
          lineCount: 0,
          cases: 0,
          netSales: 0,
          grossProfit: 0,
          sapGrossProfit: 0,
        },
        salesByPrincipal: new Map(),
      };
      docs.set(docKey, doc);
    }
    doc.row.lineCount += 1;
    doc.row.cases += cases;
    doc.row.netSales += line.salesAmount;
    doc.row.grossProfit += line.grossMargin;
    doc.row.sapGrossProfit += line.sapGrossProfit;
    const principalEntry = doc.salesByPrincipal.get(resolved.principal) ?? { sales: 0, source: resolved.source };
    principalEntry.sales += Math.abs(line.salesAmount);
    doc.salesByPrincipal.set(resolved.principal, principalEntry);

    const [year, month] = line.docDate.split("-");
    const monthIndex = Number(month) - 1;
    const monthlyKey = [year, monthIndex, resolved.principal, line.cardCode, sfaCustomerKey(customer.name), customer.contact, line.slpCode].join("|");
    const bucket = monthly.get(monthlyKey) ?? {
      row: {
        year,
        monthIndex,
        principal: resolved.principal,
        cardCode: line.cardCode,
        accountName: line.accountName,
        sfaCustomer: customer.name,
        sfaContact: customer.contact,
        slpCode: line.slpCode,
        repName: line.repName,
        docCount: 0,
        cases: 0,
        revenue: 0,
        grossProfit: 0,
      },
      docs: new Set<string>(),
    };
    bucket.row.cases += cases;
    bucket.row.revenue += line.salesAmount;
    bucket.row.grossProfit += line.grossMargin;
    bucket.docs.add(docKey);
    monthly.set(monthlyKey, bucket);
  }

  const documents: SfaDocumentRow[] = [];
  for (const doc of docs.values()) {
    const dominant = Array.from(doc.salesByPrincipal.entries()).sort((a, b) => b[1].sales - a[1].sales || a[0].localeCompare(b[0]))[0];
    if (dominant) {
      doc.row.principal = dominant[0];
      doc.row.principalSource = dominant[1].source;
    }
    documents.push(doc.row);
  }

  const monthlyRows = Array.from(monthly.values()).map(({ row, docs: docSet }) => ({ ...row, docCount: docSet.size }));

  return {
    documents,
    monthlyRows,
    stats: {
      lines: lines.length,
      documents: documents.length,
      sfaNamedDocuments: documents.filter((d) => d.sfaNameSource === "SFA").length,
      accountFallbackDocuments: documents.filter((d) => d.sfaNameSource === "ACCOUNT").length,
      principalSalesBySource: salesBySource,
      unallocatedItems: Array.from(unallocated.values()).sort((a, b) => Math.abs(b.sales) - Math.abs(a.sales)),
    },
  };
}
