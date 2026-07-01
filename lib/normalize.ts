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
