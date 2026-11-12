import { prisma } from "./db";
import { normalizeRepName, REP_SOURCES, type RepDirectoryInput, type RepSource } from "./repDirectoryBuild";

// Database side of the rep directory (docs/rep-directory-scope.md): the sync's upsert and the reads behind
// Admin > Rep directory. The builders that decide what an entry looks like are in repDirectoryBuild.ts.

export interface RepDirectorySyncResult {
  created: number;
  updated: number;
  deactivated: number;
  unchanged: number;
}

/** A source that suddenly sends less than this share of what the directory already holds is treated as a failed
 *  read, not as a mass departure: nothing is deactivated and the run fails loudly. */
const MIN_KEEP_RATIO = 0.5;
const GUARD_MIN_EXISTING = 20;
const WRITE_CHUNK = 100;
const KEY_CHUNK = 500;

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const same = (a: Date | null | undefined, b: Date | null | undefined) => (a?.getTime() ?? null) === (b?.getTime() ?? null);

/** Makes the directory's rows for one source match what the source just sent. New identities are added, changed ones
 *  updated (only when something differs), and identities the source no longer sends are marked inactive, never deleted. */
export async function syncRepDirectory(source: RepSource, inputs: RepDirectoryInput[], now: Date = new Date()): Promise<RepDirectorySyncResult> {
  const incoming = new Map<string, RepDirectoryInput>();
  for (const input of inputs) incoming.set(input.sourceKey, input);

  const existing = await prisma.repDirectoryEntry.findMany({ where: { source } });
  if (existing.length >= GUARD_MIN_EXISTING && incoming.size < existing.length * MIN_KEEP_RATIO) {
    throw new Error(`${source} sent ${incoming.size} reps but the directory holds ${existing.length}. Treating this as a failed read and changing nothing.`);
  }
  if (incoming.size === 0) throw new Error(`${source} sent no reps. Nothing to sync.`);

  const existingByKey = new Map(existing.map((row) => [row.sourceKey, row]));
  const toCreate: Array<RepDirectoryInput & { normalizedName: string }> = [];
  const toUpdate: Array<{ id: string; data: Record<string, unknown> }> = [];
  let unchanged = 0;

  for (const [key, input] of incoming) {
    const normalizedName = normalizeRepName(input.displayName);
    const row = existingByKey.get(key);
    if (!row) {
      toCreate.push({ ...input, normalizedName });
      continue;
    }
    const next = {
      displayName: input.displayName,
      normalizedName,
      origin: input.origin,
      isActive: input.isActive,
      isFieldRep: input.isFieldRep,
      groupLabel: input.groupLabel ?? null,
      region: input.region ?? null,
      principalHint: input.principalHint ?? null,
      branch: input.branch ?? null,
      loginName: input.loginName ?? null,
      lastActivityAt: input.lastActivityAt ?? null,
    };
    const differs =
      row.displayName !== next.displayName ||
      row.normalizedName !== next.normalizedName ||
      row.origin !== next.origin ||
      row.isActive !== next.isActive ||
      row.isFieldRep !== next.isFieldRep ||
      row.groupLabel !== next.groupLabel ||
      row.region !== next.region ||
      row.principalHint !== next.principalHint ||
      row.branch !== next.branch ||
      row.loginName !== next.loginName ||
      !same(row.lastActivityAt, next.lastActivityAt);
    if (differs) toUpdate.push({ id: row.id, data: next });
    else unchanged += 1;
  }

  const vanished = existing.filter((row) => row.isActive && !incoming.has(row.sourceKey));

  for (const batch of chunks(toCreate, WRITE_CHUNK)) {
    await prisma.repDirectoryEntry.createMany({
      data: batch.map((input) => ({
        source,
        sourceKey: input.sourceKey,
        displayName: input.displayName,
        normalizedName: input.normalizedName,
        origin: input.origin,
        isActive: input.isActive,
        isFieldRep: input.isFieldRep,
        groupLabel: input.groupLabel ?? null,
        region: input.region ?? null,
        principalHint: input.principalHint ?? null,
        branch: input.branch ?? null,
        loginName: input.loginName ?? null,
        lastActivityAt: input.lastActivityAt ?? null,
        firstSeenAt: now,
        lastSeenAt: now,
      })),
      skipDuplicates: true,
    });
  }
  for (const batch of chunks(toUpdate, WRITE_CHUNK)) {
    await prisma.$transaction(batch.map((item) => prisma.repDirectoryEntry.update({ where: { id: item.id }, data: { ...item.data, lastSeenAt: now } })));
  }
  if (vanished.length > 0) {
    await prisma.repDirectoryEntry.updateMany({ where: { id: { in: vanished.map((row) => row.id) } }, data: { isActive: false } });
  }
  // "Last seen" moves for every identity the source sent this time, changed or not.
  for (const batch of chunks(Array.from(incoming.keys()), KEY_CHUNK)) {
    await prisma.repDirectoryEntry.updateMany({ where: { source, sourceKey: { in: batch } }, data: { lastSeenAt: now } });
  }

  return { created: toCreate.length, updated: toUpdate.length, deactivated: vanished.length, unchanged };
}

// ---- reads for Admin > Rep directory ---------------------------------------------------------

export interface RosterMatch {
  employeeCode: string;
  name: string;
  active: boolean;
  /** True for an explicit link (made on the roster or this page); false for a name match only. */
  linked?: boolean;
}

export interface RepDirectoryRow {
  id: string;
  source: RepSource;
  sourceKey: string;
  displayName: string;
  origin: string;
  isActive: boolean;
  isFieldRep: boolean;
  groupLabel: string | null;
  region: string | null;
  principalHint: string | null;
  branch: string | null;
  loginName: string | null;
  lastActivityAt: Date | null;
  lastSeenAt: Date;
  /** Roster employees linked to this identity, then (SAP and Pine) ones that match it by name or Pine user id without a link. */
  roster: RosterMatch[];
}

export interface RepDirectoryFilters {
  q?: string;
  source?: string;
  status?: string; // "active" | "inactive" | "all"
  roster?: string; // "on" | "off" | "all"
  fieldRepsOnly?: boolean;
}

export interface RepDirectoryOverview {
  rows: RepDirectoryRow[];
  matchedTotal: number;
  shown: number;
  bySource: Array<{ source: RepSource; total: number; active: number; offRoster: number; lastSeenAt: Date | null }>;
}

export const REP_DIRECTORY_PAGE_SIZE = 300;

function isSource(value: unknown): value is RepSource {
  return typeof value === "string" && (REP_SOURCES as readonly string[]).includes(value);
}

/** Roster employees for this directory identity: the ones explicitly linked to it, then (SAP and Pine only) any that match it by the
 *  dashboard's name matching without a link: SAP by SAP name, Pine by user id (the roster's employee code) or Pine name. Derived sources
 *  match only by link. */
export function rosterMatchesFor(
  entry: { source: string; sourceKey: string; normalizedName: string },
  indexes: { bySapName: Map<string, RosterMatch[]>; byPineName: Map<string, RosterMatch[]>; byCode: Map<string, RosterMatch>; linked?: Map<string, RosterMatch[]> }
): RosterMatch[] {
  const linked = (indexes.linked?.get(`${entry.source}|${entry.sourceKey}`) ?? []).map((match) => ({ ...match, linked: true }));
  let byName: RosterMatch[] = [];
  if (entry.source === "SAP") byName = indexes.bySapName.get(entry.normalizedName) ?? [];
  else if (entry.source === "PINE") {
    const byCode = indexes.byCode.get(entry.sourceKey);
    byName = byCode ? [byCode] : indexes.byPineName.get(entry.normalizedName) ?? [];
  }
  const taken = new Set(linked.map((match) => match.employeeCode));
  return [...linked, ...byName.filter((match) => !taken.has(match.employeeCode)).map((match) => ({ ...match, linked: false }))];
}

export async function getRepDirectoryOverview(filters: RepDirectoryFilters): Promise<RepDirectoryOverview> {
  const [employees, summary, links] = await Promise.all([
    prisma.employeeMaster.findMany({ select: { employeeCode: true, pineName: true, sapName: true, active: true } }),
    prisma.repDirectoryEntry.groupBy({ by: ["source", "isActive"], _count: { _all: true }, _max: { lastSeenAt: true } }),
    prisma.employeeRepLink.findMany({ select: { employeeCode: true, source: true, sourceKey: true } }),
  ]);

  const bySapName = new Map<string, RosterMatch[]>();
  const byPineName = new Map<string, RosterMatch[]>();
  const byCode = new Map<string, RosterMatch>();
  for (const e of employees) {
    const match: RosterMatch = { employeeCode: e.employeeCode, name: e.pineName, active: e.active };
    byCode.set(e.employeeCode, match);
    for (const [map, name] of [[bySapName, e.sapName], [byPineName, e.pineName]] as const) {
      const key = normalizeRepName(name);
      if (!key) continue;
      map.set(key, [...(map.get(key) ?? []), match]);
    }
  }
  const linked = new Map<string, RosterMatch[]>();
  for (const link of links) {
    const employee = byCode.get(link.employeeCode);
    if (employee) linked.set(`${link.source}|${link.sourceKey}`, [...(linked.get(`${link.source}|${link.sourceKey}`) ?? []), employee]);
  }
  const indexes = { bySapName, byPineName, byCode, linked };

  const q = (filters.q ?? "").trim();
  const normalizedQ = normalizeRepName(q);
  const where = {
    ...(isSource(filters.source) ? { source: filters.source } : {}),
    ...(filters.status === "inactive" ? { isActive: false } : filters.status === "all" ? {} : { isActive: true }),
    ...(filters.fieldRepsOnly ? { isFieldRep: true } : {}),
    ...(q
      ? {
          OR: [
            ...(normalizedQ ? [{ normalizedName: { contains: normalizedQ } }] : []),
            { sourceKey: { contains: q, mode: "insensitive" as const } },
            { loginName: { contains: q, mode: "insensitive" as const } },
            { groupLabel: { contains: q, mode: "insensitive" as const } },
            { principalHint: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };
  const entries = await prisma.repDirectoryEntry.findMany({
    where,
    orderBy: [{ isActive: "desc" }, { displayName: "asc" }],
    take: 5000,
  });

  let rows: RepDirectoryRow[] = entries.map((entry) => ({
    id: entry.id,
    source: entry.source as RepSource,
    sourceKey: entry.sourceKey,
    displayName: entry.displayName,
    origin: entry.origin,
    isActive: entry.isActive,
    isFieldRep: entry.isFieldRep,
    groupLabel: entry.groupLabel,
    region: entry.region,
    principalHint: entry.principalHint,
    branch: entry.branch,
    loginName: entry.loginName,
    lastActivityAt: entry.lastActivityAt,
    lastSeenAt: entry.lastSeenAt,
    roster: rosterMatchesFor(entry, indexes),
  }));
  if (filters.roster === "on") rows = rows.filter((row) => row.roster.length > 0);
  if (filters.roster === "off") rows = rows.filter((row) => row.roster.length === 0);

  // Per-source counts for the header cards. "Off roster" counts active field reps with no roster link or name match, for SAP and Pine.
  const allActiveField = await prisma.repDirectoryEntry.findMany({
    where: { isActive: true, isFieldRep: true, source: { in: ["SAP", "PINE"] } },
    select: { source: true, sourceKey: true, normalizedName: true },
  });
  const offRosterBySource = new Map<string, number>();
  for (const entry of allActiveField) {
    if (rosterMatchesFor(entry, indexes).length === 0) offRosterBySource.set(entry.source, (offRosterBySource.get(entry.source) ?? 0) + 1);
  }

  const bySource = REP_SOURCES.map((source) => {
    const parts = summary.filter((row) => row.source === source);
    const total = parts.reduce((sum, row) => sum + row._count._all, 0);
    const active = parts.filter((row) => row.isActive).reduce((sum, row) => sum + row._count._all, 0);
    const lastSeen = parts.reduce<Date | null>((latest, row) => (row._max.lastSeenAt && (!latest || row._max.lastSeenAt > latest) ? row._max.lastSeenAt : latest), null);
    return { source, total, active, offRoster: offRosterBySource.get(source) ?? 0, lastSeenAt: lastSeen };
  });

  return { rows: rows.slice(0, REP_DIRECTORY_PAGE_SIZE), matchedTotal: rows.length, shown: Math.min(rows.length, REP_DIRECTORY_PAGE_SIZE), bySource };
}
