// Global Ageing takes a customer's principal from SAP's "Property" flags on the customer record. A customer opened recently, or never flagged, has none and
// used to fall into "Unclassified". Those customers do have sales history, so they are placed by what they actually buy: the brand with the most net sales
// in the last 18 months, written in the same vocabulary as the SAP Property labels ("UKL", "UPFIELD", "Mars"...). Nothing is written back to SAP or to the
// customer profile; the report shows where a placement was inferred so the Property can still be set at source.

export type PrincipalSource = "SAP Property" | "Inferred from sales" | "Unclassified";

export interface CustomerSales {
  cardCode: string;
  /** The sales document's principal, e.g. "Unilever-Nyeri". */
  principal: string;
  netSales: number;
}

export interface ClassifiedCustomer {
  customerCode: string;
  principal: string | null;
}

/** SAP Property labels that differ from the brand name used in sales, used only when no classified customer teaches the mapping. */
const LABEL_ALIASES: Record<string, string> = { unilever: "UKL", upfield: "UPFIELD", bic: "BIC", promasidor: "Promasdar", premier: "Premier" };

/** The brand of a principal ("Unilever-Nyeri" -> "unilever"): the part before the last hyphen, lower case, letters and digits only. */
export function brandKey(principal: string): string {
  const trimmed = principal.trim();
  const dash = trimmed.lastIndexOf("-");
  const brand = dash > 0 ? trimmed.slice(0, dash) : trimmed;
  return brand.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** "Unilever-Nyeri" -> "Unilever", for a brand with no Property label to borrow. */
function brandDisplay(principal: string): string {
  const trimmed = principal.trim();
  const dash = trimmed.lastIndexOf("-");
  return dash > 0 ? trimmed.slice(0, dash).trim() : trimmed;
}

/** The brand a customer buys most (net of returns); null when nothing positive. */
function dominantBrand(sales: CustomerSales[]): { key: string; display: string } | null {
  const byBrand = new Map<string, { display: string; net: number }>();
  for (const s of sales) {
    const key = brandKey(s.principal);
    if (!key) continue;
    const entry = byBrand.get(key) ?? { display: brandDisplay(s.principal), net: 0 };
    entry.net += s.netSales;
    byBrand.set(key, entry);
  }
  let best: { key: string; display: string; net: number } | null = null;
  for (const [key, entry] of byBrand) if (entry.net > 0 && (!best || entry.net > best.net)) best = { key, ...entry };
  return best ? { key: best.key, display: best.display } : null;
}

/** Learns which SAP Property label each sales brand carries, from the customers that have both. */
export function learnPropertyLabels(classified: ClassifiedCustomer[], sales: CustomerSales[]): Map<string, string> {
  const salesByCustomer = new Map<string, CustomerSales[]>();
  for (const s of sales) (salesByCustomer.get(s.cardCode) ?? salesByCustomer.set(s.cardCode, []).get(s.cardCode)!).push(s);
  const votes = new Map<string, Map<string, number>>();
  for (const c of classified) {
    const label = c.principal?.trim();
    if (!label) continue;
    const brand = dominantBrand(salesByCustomer.get(c.customerCode) ?? []);
    if (!brand) continue;
    const forBrand = votes.get(brand.key) ?? votes.set(brand.key, new Map()).get(brand.key)!;
    forBrand.set(label, (forBrand.get(label) ?? 0) + 1);
  }
  const learned = new Map<string, string>();
  for (const [brand, labels] of votes) {
    const total = [...labels.values()].reduce((a, b) => a + b, 0);
    const [top, n] = [...labels.entries()].sort((a, b) => b[1] - a[1])[0];
    if (total >= 3 && n / total >= 0.6) learned.set(brand, top);
  }
  return learned;
}

export interface InferredPrincipal {
  principal: string;
  source: PrincipalSource;
}

/** For every customer with no Property, the principal it buys most; customers with a Property, or with no usable sales, are left out. */
export function inferPrincipals(customers: ClassifiedCustomer[], sales: CustomerSales[]): Map<string, InferredPrincipal> {
  const learned = learnPropertyLabels(customers, sales);
  const salesByCustomer = new Map<string, CustomerSales[]>();
  for (const s of sales) (salesByCustomer.get(s.cardCode) ?? salesByCustomer.set(s.cardCode, []).get(s.cardCode)!).push(s);
  const out = new Map<string, InferredPrincipal>();
  for (const c of customers) {
    if (c.principal && c.principal.trim() !== "") continue;
    const brand = dominantBrand(salesByCustomer.get(c.customerCode) ?? []);
    if (!brand) continue;
    out.set(c.customerCode, { principal: learned.get(brand.key) ?? LABEL_ALIASES[brand.key] ?? brand.display, source: "Inferred from sales" });
  }
  return out;
}
