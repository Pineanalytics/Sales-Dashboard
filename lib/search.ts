// Pure, side-effect-free global search over the already-loaded Dataset. No React/store
// imports — kept in lib/ alongside the other pure computation modules.
//
// Deliberately does NOT search Products: product master data lives only in a
// server-side Prisma table used by the SQL bridge scripts, never loaded into the
// client-side Dataset. Adding it would need a new API endpoint, out of scope here.
import type { Dataset } from "./types";

export type SearchResultType = "rep" | "principal" | "location" | "customer";

export interface SearchResult {
  type: SearchResultType;
  label: string;
  /** For "principal", the raw principal string (e.g. "EABL-Nyeri") — despite the field
   *  name, lib/store.ts's selectPrincipal()/every view normalizes it internally via
   *  normalizePrincipalKey(); it is NOT the pre-normalized brand key. Matches
   *  MonthlySalesRow.principal, the same value principalsByRevenueDesc() surfaces as
   *  its own (confusingly-named) `principalKey` field. Otherwise same as label. */
  key: string;
  sublabel?: string;
}

const TYPE_LABELS: Record<SearchResultType, string> = {
  rep: "Reps",
  principal: "Principals",
  location: "Locations",
  customer: "Customers",
};

export function searchResultTypeLabel(type: SearchResultType): string {
  return TYPE_LABELS[type];
}

export function buildSearchIndex(dataset: Dataset): SearchResult[] {
  const reps = new Map<string, SearchResult>();
  const principals = new Map<string, SearchResult>();
  const locations = new Map<string, SearchResult>();
  const customers = new Map<string, SearchResult>();

  for (const row of dataset.monthlySales) {
    if (row.principal && !principals.has(row.principal)) {
      principals.set(row.principal, { type: "principal", label: row.principal, key: row.principal, sublabel: row.location });
    }
    if (row.location && !locations.has(row.location)) {
      locations.set(row.location, { type: "location", label: row.location, key: row.location });
    }
  }

  for (const row of dataset.monthlyCoverage) {
    const name = row.employeeName.trim();
    if (name && !reps.has(name)) {
      reps.set(name, { type: "rep", label: name, key: name, sublabel: row.salesRole });
    }
  }

  for (const row of dataset.monthlyBrandCustomer) {
    const repName = row.salesEmployee.trim();
    if (repName && !reps.has(repName)) {
      reps.set(repName, { type: "rep", label: repName, key: repName });
    }
    const customerName = row.customerName.trim();
    if (customerName && !customers.has(customerName)) {
      customers.set(customerName, { type: "customer", label: customerName, key: customerName, sublabel: row.principal });
    }
  }

  return [...reps.values(), ...principals.values(), ...locations.values(), ...customers.values()];
}

const MAX_RESULTS = 20;

/** Case-insensitive substring match; results starting with the query rank above
 *  results merely containing it. */
export function searchIndex(index: SearchResult[], query: string): SearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const starts: SearchResult[] = [];
  const includes: SearchResult[] = [];

  for (const result of index) {
    const label = result.label.toLowerCase();
    if (label.startsWith(q)) starts.push(result);
    else if (label.includes(q)) includes.push(result);
  }

  return [...starts, ...includes].slice(0, MAX_RESULTS);
}
