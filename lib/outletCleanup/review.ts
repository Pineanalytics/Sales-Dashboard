// What the admin reviews: the entries and duplicate calls the teams have saved, with what each changes against the universe.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { FIELD_LABELS, IDENTIFICATION_FIELDS, type RepDecision } from "./types";

export const REVIEW_PAGE_SIZE = 25;
export const REVIEW_STATUSES = ["REVIEWED", "VALIDATED", "APPLIED", "REJECTED"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export interface ReviewChange {
  field: string;
  label: string;
  from: string;
  to: string;
}

export interface ReviewRow {
  id: string;
  source: string;
  outletKey: string;
  outletName: string;
  teamLeader: string | null;
  status: ReviewStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  adminNote: string | null;
  /** The identification values the team leader changed, against what the universe has. */
  changes: ReviewChange[];
  /** Fields confirmed as correct without a change. */
  confirmed: string[];
  geo: { from: string | null; to: string; accuracyM: number | null; distanceM: number | null; flagged: boolean } | null;
  reps: { principal: string; from: string | null; to: string; action: string }[];
  /** Why an admin might look twice before validating. */
  flags: string[];
}

export interface DuplicateReviewRow {
  id: string;
  decision: "MERGE" | "NOT_DUPLICATE";
  status: ReviewStatus;
  teamLeader: string | null;
  decidedBy: string;
  decidedAt: string;
  note: string | null;
  a: { source: string; outletKey: string; outletName: string; territory: string; principals: string };
  b: { source: string; outletKey: string; outletName: string; territory: string; principals: string };
}

const statusOf = (value: string | null | undefined): ReviewStatus => ((REVIEW_STATUSES as readonly string[]).includes(value ?? "") ? (value as ReviewStatus) : "REVIEWED");

interface UniverseSnapshot {
  source: string;
  outletKey: string;
  outletName: string;
  principal: string;
  region: string;
  territory: string;
  channel: string;
  segment: string;
  latitude: number | null;
  longitude: number | null;
  repName: string | null;
  contactName: string | null;
  contactPhone: string | null;
}

async function universeFor(pairs: { source: string; outletKey: string }[]): Promise<Map<string, UniverseSnapshot[]>> {
  const out = new Map<string, UniverseSnapshot[]>();
  if (pairs.length === 0) return out;
  const rows = await prisma.$queryRaw<UniverseSnapshot[]>(Prisma.sql`
    SELECT source, "outletKey", "outletName", principal, region, COALESCE("territoryClean", territory) AS territory, channel, segment, latitude, longitude, "repName", "contactName", "contactPhone"
    FROM "OutletUniverse" WHERE (source, "outletKey") IN (${Prisma.join(pairs.map((p) => Prisma.sql`(${p.source}, ${p.outletKey})`))})
    ORDER BY principal
  `);
  for (const row of rows) {
    const key = `${row.source}|${row.outletKey}`;
    out.set(key, [...(out.get(key) ?? []), row]);
  }
  return out;
}

export async function listReviewEntries(filters: { status: string; q: string; teamLeader: string | null }, page: number): Promise<{ rows: ReviewRow[]; total: number; page: number; pageCount: number }> {
  const where: Prisma.OutletCleanupEntryWhereInput = {
    status: filters.status === "ALL" ? undefined : statusOf(filters.status),
    ...(filters.teamLeader ? { teamLeader: { equals: filters.teamLeader, mode: "insensitive" } } : {}),
    ...(filters.q ? { OR: [{ outletName: { contains: filters.q, mode: "insensitive" } }, { outletKey: { contains: filters.q, mode: "insensitive" } }] } : {}),
  };
  const total = await prisma.outletCleanupEntry.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / REVIEW_PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pageCount);
  const entries = await prisma.outletCleanupEntry.findMany({ where, orderBy: { reviewedAt: "asc" }, skip: (current - 1) * REVIEW_PAGE_SIZE, take: REVIEW_PAGE_SIZE });
  const pairs = entries.map((e) => ({ source: e.source, outletKey: e.outletKey }));
  const [universe, geoLogs] = await Promise.all([
    universeFor(pairs),
    pairs.length === 0
      ? Promise.resolve([])
      : prisma.outletCleanupLog.findMany({ where: { action: "GEO_TAG", OR: pairs.map((p) => ({ source: p.source, outletKey: p.outletKey })) }, orderBy: { at: "desc" }, select: { source: true, outletKey: true, changes: true } }),
  ]);
  const latestGeo = new Map<string, { distanceM: number | null; farFromPrevious: boolean }>();
  for (const log of geoLogs) {
    const key = `${log.source}|${log.outletKey}`;
    if (!latestGeo.has(key) && log.changes && typeof log.changes === "object") {
      const c = log.changes as { distanceM?: number | null; farFromPrevious?: boolean };
      latestGeo.set(key, { distanceM: c.distanceM ?? null, farFromPrevious: Boolean(c.farFromPrevious) });
    }
  }

  const rows: ReviewRow[] = entries.map((e) => {
    const key = `${e.source}|${e.outletKey}`;
    const base = universe.get(key) ?? [];
    const lead = base[0];
    const was: Record<string, string> = lead
      ? { region: lead.region, territory: lead.territory, channel: lead.channel, customerType: lead.segment, contactName: lead.contactName ?? "", contactPhone: lead.contactPhone ?? "" }
      : {};
    const changes: ReviewChange[] = [];
    const confirmed: string[] = [];
    for (const field of IDENTIFICATION_FIELDS) {
      const to = e[field];
      if (to) changes.push({ field, label: FIELD_LABELS[field], from: was[field] ?? "", to });
      else if (e.lockedFields.includes(field)) confirmed.push(FIELD_LABELS[field]);
    }
    const decisions = Array.isArray(e.repDecisions) ? (e.repDecisions as unknown as RepDecision[]) : [];
    const geoInfo = latestGeo.get(key);
    const point = base.find((r) => r.latitude !== null && r.latitude !== 0);
    const flags: string[] = [];
    if (geoInfo?.farFromPrevious) flags.push(`GPS moved ${geoInfo.distanceM} m`);
    if (e.latitude !== null && e.geoAccuracyM !== null && e.geoAccuracyM > 50) flags.push(`GPS fix only ${Math.round(e.geoAccuracyM)} m accurate`);
    for (const d of decisions) if (d.action === "CHANGED") flags.push(`${d.principal}: rep changed`);
    if (e.territory && lead && e.territory.toLowerCase() !== lead.territory.toLowerCase()) flags.push("Territory changed");
    return {
      id: e.id,
      source: e.source,
      outletKey: e.outletKey,
      outletName: e.outletName,
      teamLeader: e.teamLeader,
      status: statusOf(e.status),
      reviewedBy: e.reviewedBy,
      reviewedAt: e.reviewedAt ? e.reviewedAt.toISOString() : null,
      adminNote: e.adminNote,
      changes,
      confirmed,
      geo: e.latitude !== null && e.longitude !== null ? { from: point ? `${point.latitude?.toFixed(5)}, ${point.longitude?.toFixed(5)}` : null, to: `${e.latitude.toFixed(5)}, ${e.longitude.toFixed(5)}`, accuracyM: e.geoAccuracyM, distanceM: geoInfo?.distanceM ?? null, flagged: Boolean(geoInfo?.farFromPrevious) } : null,
      reps: decisions.map((d) => ({ principal: d.principal, from: d.previousRep, to: d.rep, action: d.action })),
      flags,
    };
  });
  return { rows, total, page: current, pageCount };
}

export async function listDuplicateReviews(filters: { status: string }, page: number): Promise<{ rows: DuplicateReviewRow[]; total: number; page: number; pageCount: number }> {
  const where: Prisma.OutletDuplicateDecisionWhereInput = { status: filters.status === "ALL" ? undefined : statusOf(filters.status) };
  const total = await prisma.outletDuplicateDecision.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / REVIEW_PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pageCount);
  const decisions = await prisma.outletDuplicateDecision.findMany({ where, orderBy: { decidedAt: "asc" }, skip: (current - 1) * REVIEW_PAGE_SIZE, take: REVIEW_PAGE_SIZE });
  const universe = await universeFor(decisions.flatMap((d) => [{ source: d.aSource, outletKey: d.aKey }, { source: d.bSource, outletKey: d.bKey }]));
  const describe = (source: string, outletKey: string) => {
    const rows = universe.get(`${source}|${outletKey}`) ?? [];
    return { source, outletKey, outletName: rows[0]?.outletName ?? "(not in the universe now)", territory: rows[0]?.territory ?? "", principals: [...new Set(rows.map((r) => r.principal))].join(", ") };
  };
  return {
    rows: decisions.map((d) => ({ id: d.id, decision: d.decision as "MERGE" | "NOT_DUPLICATE", status: statusOf(d.status), teamLeader: d.teamLeader, decidedBy: d.decidedBy, decidedAt: d.decidedAt.toISOString(), note: d.note, a: describe(d.aSource, d.aKey), b: describe(d.bSource, d.bKey) })),
    total,
    page: current,
    pageCount,
  };
}
