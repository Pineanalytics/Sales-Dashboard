// Pure builders for the rep directory (docs/rep-directory-scope.md): turn what each system sends into
// directory entries. No database and no network, so the syncs and their tests share one definition.

export const REP_SOURCES = ["SAP", "PINE", "LEVERAGE", "DATAEDGE", "EABL_DMS"] as const;
export type RepSource = (typeof REP_SOURCES)[number];

export const REP_SOURCE_LABELS: Record<RepSource, string> = {
  SAP: "SAP",
  PINE: "Pine (SFA)",
  LEVERAGE: "Leverage",
  DATAEDGE: "Upfield DataEdge",
  EABL_DMS: "EABL DMS",
};

/** One identity as the sync hands it to the directory. */
export interface RepDirectoryInput {
  sourceKey: string;
  displayName: string;
  origin: "TABLE" | "DERIVED";
  isActive: boolean;
  isFieldRep: boolean;
  groupLabel?: string | null;
  region?: string | null;
  principalHint?: string | null;
  branch?: string | null;
  loginName?: string | null;
  lastActivityAt?: Date | null;
}

/** Same shape as the roster's own person-name normaliser: case, punctuation and spacing do not matter. */
export function normalizeRepName(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** A derived identity counts as active when it sold, visited or called within this many days. */
export const DERIVED_ACTIVE_DAYS = 90;

function clean(value: string | null | undefined): string | null {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  return text ? text : null;
}

function isRecent(date: Date | null | undefined, now: Date): boolean {
  return !!date && now.getTime() - date.getTime() <= DERIVED_ACTIVE_DAYS * 86_400_000;
}

function later(a: Date | null | undefined, b: Date | null | undefined): Date | null {
  if (a && b) return a.getTime() >= b.getTime() ? a : b;
  return a ?? b ?? null;
}

// ---- SAP: OSLP -------------------------------------------------------------------------------

export interface SapSalespersonRow {
  slpCode: number;
  slpName: string | null;
  active: string | null; // 'Y' | 'N'
  locked: string | null; // 'Y' | 'N'
  principal: string | null; // U_Principle
  branch: string | null; // U_Branch
  salesUnit: string | null; // U_SalesUnit
}

/** One entry per salesperson with a name. SlpCode 0 and below is SAP's "no sales employee" placeholder: kept so
 *  it can be found, but never a field rep and never active. */
export function buildSapEntries(rows: SapSalespersonRow[], lastActivityByCode: Map<number, Date>): RepDirectoryInput[] {
  const entries: RepDirectoryInput[] = [];
  for (const row of rows) {
    const name = clean(row.slpName);
    if (!name) continue;
    const real = row.slpCode > 0;
    entries.push({
      sourceKey: String(row.slpCode),
      displayName: name,
      origin: "TABLE",
      isActive: real && row.active === "Y" && row.locked !== "Y",
      isFieldRep: real,
      groupLabel: clean(row.salesUnit),
      principalHint: clean(row.principal),
      branch: clean(row.branch),
      lastActivityAt: lastActivityByCode.get(row.slpCode) ?? null,
    });
  }
  return entries;
}

// ---- Pine: users -----------------------------------------------------------------------------

/** The Pine sales groups the dashboard treats as field reps (the same list the Coverage and Timestamps reads use). */
export const PINE_FIELD_GROUPS = ["DSR", "MBSR", "TDR", "TL", "KAMs", "Admin"] as const;

/** The one query that reads Pine's user list. pine.users also holds password hashes, salts, one-time codes and API keys, so the
 *  columns are named here and the query must never select *. tests/repDirectory.test.ts enforces both. */
export const PINE_USERS_QUERY = "SELECT id, first_name, last_name, salesgroup, region, active FROM pine.users";

export interface PineUserRow {
  id: number;
  firstName: string | null;
  lastName: string | null;
  salesGroup: string | null;
  region: string | null;
  active: number | boolean | null;
}

/** One entry per Pine user with a name. All groups are kept (store staff, unassigned) and flagged, so any user can
 *  still be found; only the field groups are field reps. */
export function buildPineEntries(rows: PineUserRow[], lastActivityById: Map<string, Date>): RepDirectoryInput[] {
  const entries: RepDirectoryInput[] = [];
  for (const row of rows) {
    const name = clean(`${row.firstName ?? ""} ${row.lastName ?? ""}`);
    if (!name) continue;
    const group = clean(row.salesGroup);
    const key = String(row.id);
    entries.push({
      sourceKey: key,
      displayName: name,
      origin: "TABLE",
      isActive: row.active === true || row.active === 1,
      isFieldRep: !!group && (PINE_FIELD_GROUPS as readonly string[]).includes(group),
      groupLabel: group,
      region: clean(row.region),
      lastActivityAt: lastActivityById.get(key) ?? null,
    });
  }
  return entries;
}

// ---- Leverage, DataEdge, EABL DMS: derived from stored sales and visit rows -------------------

export interface LeverageRepRow {
  branch: string; // SalesReturnLine.storageLocation
  repCode: string;
  repName: string;
  lastDate: Date | null;
}

/** Leverage's Centegy feed gives a rep code and a name on every line. One entry per branch and code; if a code has been
 *  spelled two ways, the spelling used most recently wins. */
export function deriveLeverageEntries(rows: LeverageRepRow[], now: Date): RepDirectoryInput[] {
  const byKey = new Map<string, LeverageRepRow>();
  for (const row of rows) {
    const name = clean(row.repName);
    const code = clean(row.repCode);
    if (!name || !code) continue;
    const key = `${row.branch}|${code}`;
    const held = byKey.get(key);
    if (!held || (row.lastDate?.getTime() ?? 0) > (held.lastDate?.getTime() ?? 0)) byKey.set(key, { ...row, repName: name, repCode: code });
  }
  return Array.from(byKey, ([sourceKey, row]) => ({
    sourceKey,
    displayName: row.repName,
    origin: "DERIVED" as const,
    isActive: isRecent(row.lastDate, now),
    isFieldRep: true,
    branch: row.branch,
    lastActivityAt: row.lastDate,
  }));
}

export interface FsrActivityRow {
  fsr: string | null;
  lastDate: Date | null;
}

export interface UpfieldLoginRow {
  fsrName: string | null;
  fsrLogin: string | null;
}

/** DataEdge sends the FSR as text on every transaction and visit. One entry per FSR, active if either feed saw them
 *  recently; the login comes from the Upfield outlet list when it names the same FSR. */
export function deriveDataEdgeEntries(transactions: FsrActivityRow[], visits: FsrActivityRow[], logins: UpfieldLoginRow[], now: Date): RepDirectoryInput[] {
  const loginByName = new Map<string, string>();
  for (const row of logins) {
    const name = normalizeRepName(row.fsrName);
    const login = clean(row.fsrLogin);
    if (name && login && !loginByName.has(name)) loginByName.set(name, login);
  }
  const byKey = new Map<string, { name: string; last: Date | null }>();
  for (const row of [...transactions, ...visits]) {
    const name = clean(row.fsr);
    if (!name) continue;
    const key = normalizeRepName(name);
    const held = byKey.get(key);
    byKey.set(key, { name: held?.name ?? name, last: later(held?.last, row.lastDate) });
  }
  return Array.from(byKey, ([key, row]) => ({
    sourceKey: row.name,
    displayName: row.name,
    origin: "DERIVED" as const,
    isActive: isRecent(row.last, now),
    isFieldRep: true,
    loginName: loginByName.get(key) ?? null,
    lastActivityAt: row.last,
  }));
}

export interface EablSalesmanRow {
  salesman: string | null;
  lastDate: Date | null;
}

/** EABL DMS has one text salesman per call. One entry per distinct name, spacing and case folded. */
export function deriveEablEntries(rows: EablSalesmanRow[], now: Date): RepDirectoryInput[] {
  const byKey = new Map<string, { name: string; last: Date | null }>();
  for (const row of rows) {
    const name = clean(row.salesman);
    if (!name) continue;
    const key = normalizeRepName(name);
    const held = byKey.get(key);
    byKey.set(key, { name: held?.name ?? name, last: later(held?.last, row.lastDate) });
  }
  return Array.from(byKey, ([, row]) => ({
    sourceKey: row.name,
    displayName: row.name,
    origin: "DERIVED" as const,
    isActive: isRecent(row.last, now),
    isFieldRep: true,
    lastActivityAt: row.last,
  }));
}
