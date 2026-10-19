// One spelling per principal. Principal.principal is a case-sensitive unique column, so a file that
// spells "Eabl-Nyeri" where the Principal table has "EABL-Nyeri" used to create a second Principal row
// (and, through the roster imports, a second set of reps and weekly targets) for the same business.
// Every importer resolves the incoming name through here first.

/** Comparison key: trimmed, single-spaced, lower case. */
export function principalNameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Returns a function that maps any spelling of a known principal to the spelling already on file.
 *  Give the known names oldest first: when two known rows differ only by case, the oldest wins. A name
 *  that matches nothing is returned trimmed and otherwise unchanged (a genuinely new principal). */
export function buildPrincipalCanonicalizer(knownOldestFirst: string[]): (name: string) => string {
  const byKey = new Map<string, string>();
  for (const name of knownOldestFirst) {
    const key = principalNameKey(name);
    if (!byKey.has(key)) byKey.set(key, name);
  }
  return (name: string) => byKey.get(principalNameKey(name)) ?? name.trim();
}

export interface PrincipalVariantGroup {
  canonical: string;
  variants: string[];
}

/** Groups principal names that differ only by case or spacing. The oldest row is the canonical spelling
 *  (it is the one the SAP sales, targets and reporting already use); the others are its variants. */
export function findPrincipalVariantGroups(rows: { principal: string; createdAt: Date }[]): PrincipalVariantGroup[] {
  const groups = new Map<string, { principal: string; createdAt: Date }[]>();
  for (const row of rows) {
    const key = principalNameKey(row.principal);
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  const result: PrincipalVariantGroup[] = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const sorted = list.slice().sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.principal.localeCompare(b.principal));
    result.push({ canonical: sorted[0].principal, variants: sorted.slice(1).map((r) => r.principal) });
  }
  return result.sort((a, b) => a.canonical.localeCompare(b.canonical));
}
