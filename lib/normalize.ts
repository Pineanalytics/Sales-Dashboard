/**
 * Normalizes a principal name to the key used to bucket multi-region rows
 * under a single brand, e.g. "EABL-Nyeri" and "EABL-Nyahururu" -> "eabl".
 */
export function normalizePrincipalKey(name: string): string {
  return name
    .trim()
    .split("-")[0]
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Normalizes a customer/SAP name for cross-referencing the same customer
 * across models that spell it slightly differently (e.g. BrandCustomerActual's
 * sapName vs CustomerCreditProfile's customerName). Same shape as the
 * long-standing local helper in scripts/db-bridge/transform/buildRepSales.ts.
 */
export function normalizeCustomerName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}
