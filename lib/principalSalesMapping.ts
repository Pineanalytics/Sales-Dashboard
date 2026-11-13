// Why does an active principal show no SAP sales? The sales sync
// (scripts/db-bridge/transform/buildMonthlySales.ts) keeps a SAP line only
// when ALL of these hold, and silently skips it otherwise:
//   1. its item is in the Product Master with a principal, e.g. "Highchem";
//   2. "<that principal>-<warehouse location>", e.g. "Highchem-Nairobi",
//      exactly matches (case included) a Principal row's name;
//   3. that Principal row's Status is Active.
// Items with no Product Master row are kept as the "unidentified products"
// worklist; the other two failures leave no trace. This pure check names
// each gap per principal so the Principals page can show it.
import { normalizePrincipalKey } from "@/lib/normalize";
import { allocatePrincipal, UNALLOCATED_PRINCIPAL, type PrincipalRule, DEFAULT_PRINCIPAL_RULES } from "@/lib/principalRules";

export interface MappingPrincipalRow {
  principal: string;
  location: string;
  status: string;
}

export interface MappingProductRow {
  itemNo: string;
  principal: string;
}

export interface MappingUnmappedSale {
  itemNo: string;
  itemDescription: string;
  revenue: number;
}

export type PrincipalMappingIssue =
  /** The name has no "-<Location>" suffix, so no SAP line can ever match it. */
  | { kind: "missing-location"; expectedExample: string }
  /** Nothing in the Product Master is mapped to this principal's base name. */
  | { kind: "no-products" }
  /** Products are mapped under a spelling that differs only in case/punctuation. */
  | { kind: "name-mismatch"; productPrincipal: string; productCount: number }
  /** Unidentified SAP items whose item-code rule points at this principal. */
  | { kind: "unmapped-items"; itemCount: number; revenue: number; examples: string[] };

export interface PrincipalMappingResult {
  principal: string;
  /** The Product Master principal name this row expects, e.g. "Highchem". */
  productName: string | null;
  productCount: number;
  hasSales: boolean;
  issues: PrincipalMappingIssue[];
}

export interface OrphanProductPrincipal {
  /** A Product Master principal name with no Active "<name>-<Location>" row. */
  productPrincipal: string;
  productCount: number;
  /** An Active row that matches it ignoring case/punctuation, if any. */
  closestPrincipal: string | null;
}

/** The Product Master name a Principal row receives sales for: its name minus the "-<Location>" suffix. */
export function productNameForPrincipal(row: MappingPrincipalRow): string | null {
  const name = row.principal.trim();
  const location = row.location.trim();
  if (location && name.toLowerCase().endsWith(`-${location.toLowerCase()}`)) return name.slice(0, name.length - location.length - 1);
  const lastDash = name.lastIndexOf("-");
  return lastDash > 0 ? name.slice(0, lastDash) : null;
}

/** Case- and punctuation-blind form of a name: "HighChem" and "Highchem" agree, "Ukl-Intl" and "UKL INTL" agree. */
function looseName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function checkPrincipalSalesMapping(input: {
  principals: MappingPrincipalRow[];
  products: MappingProductRow[];
  unmapped: MappingUnmappedSale[];
  /** Principal names with at least one SalesRecord month. */
  principalsWithSales: Set<string>;
  rules?: PrincipalRule[];
}): { principals: PrincipalMappingResult[]; orphanProductPrincipals: OrphanProductPrincipal[] } {
  const rules = input.rules ?? DEFAULT_PRINCIPAL_RULES;
  const productCountByName = new Map<string, number>();
  for (const product of input.products) {
    const name = product.principal.trim();
    if (name) productCountByName.set(name, (productCountByName.get(name) ?? 0) + 1);
  }

  // Unidentified SAP items, grouped by the principal their item-code rule suggests.
  const unmappedByKey = new Map<string, { items: Map<string, string>; revenue: number }>();
  for (const sale of input.unmapped) {
    const { principal } = allocatePrincipal(sale.itemNo, sale.itemDescription, rules);
    if (principal === UNALLOCATED_PRINCIPAL) continue;
    const key = normalizePrincipalKey(principal);
    const entry = unmappedByKey.get(key) ?? { items: new Map(), revenue: 0 };
    entry.items.set(sale.itemNo, sale.itemDescription);
    entry.revenue += sale.revenue;
    unmappedByKey.set(key, entry);
  }

  const active = input.principals.filter((row) => row.status === "Active");
  const results: PrincipalMappingResult[] = active.map((row) => {
    const productName = productNameForPrincipal(row);
    const issues: PrincipalMappingIssue[] = [];
    if (!productName) {
      issues.push({ kind: "missing-location", expectedExample: `${row.principal.trim()}-${row.location.trim() || "Nairobi"}` });
    }
    const productCount = productName ? (productCountByName.get(productName) ?? 0) : 0;
    const key = normalizePrincipalKey(productName ?? row.principal);
    const hasSales = input.principalsWithSales.has(row.principal);
    // A principal that already receives SAP sales is mapped well enough; only an empty one needs the product check.
    if (productName && productCount === 0 && !hasSales) {
      issues.push({ kind: "no-products" });
      for (const [name, count] of productCountByName) {
        if (name !== productName && looseName(name) === looseName(productName)) {
          issues.push({ kind: "name-mismatch", productPrincipal: name, productCount: count });
        }
      }
    }
    const unmapped = unmappedByKey.get(key);
    if (unmapped && unmapped.items.size > 0) {
      issues.push({ kind: "unmapped-items", itemCount: unmapped.items.size, revenue: unmapped.revenue, examples: Array.from(unmapped.items.keys()).slice(0, 3) });
    }
    return { principal: row.principal, productName, productCount, hasSales, issues };
  });
  // Unidentified SAP items first (the fix is right there to make), then the principals with no sales at all.
  const rank = (row: PrincipalMappingResult) => (row.issues.some((issue) => issue.kind === "unmapped-items") ? 0 : row.hasSales ? 2 : 1);
  results.sort((a, b) => rank(a) - rank(b) || a.principal.localeCompare(b.principal));

  // A name served by any Principal row (a Past one is excluded from sales on purpose) is not an orphan.
  const knownProductNames = new Set(input.principals.map(productNameForPrincipal).filter((name): name is string => Boolean(name)));
  const orphanProductPrincipals: OrphanProductPrincipal[] = [];
  for (const [name, count] of productCountByName) {
    if (knownProductNames.has(name)) continue;
    const closest = active.find((row) => looseName(productNameForPrincipal(row) ?? row.principal) === looseName(name));
    orphanProductPrincipals.push({ productPrincipal: name, productCount: count, closestPrincipal: closest?.principal ?? null });
  }
  orphanProductPrincipals.sort((a, b) => b.productCount - a.productCount);

  return { principals: results, orphanProductPrincipals };
}
