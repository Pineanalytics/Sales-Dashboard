// Puts the cleanup an admin has approved into the universe while it is compiled, so it survives every rebuild:
//   - validated identification (region, territory, channel, customer type, contact name and phone) and GPS points replace what the source system had;
//   - validated rep decisions put the chosen rep (and their team leader) on the outlet's rows for that principal;
//   - a marked-open outlet a team claimed moves to the claiming team leader; one the admin closed without an owner has no team leader;
//   - validated duplicate calls: "same shop" joins two outlets into one shop, "not a duplicate" takes them out of the shop the dedup put them in.
// The pure functions are applied by rebuild.ts; loadApprovedCleanup reads the approved work from the cleanup tables.
import { recordKey } from "@/lib/universeAnalysis/pipeline";
import { OUTLET_SOURCE_LABELS, type OutletSource } from "@/lib/outletUniverse/normalize";
import type { RepDecision } from "./types";

const fold = (value: string | null | undefined) => (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
const outletId = (source: string, outletKey: string) => `${source}|${outletKey}`;

export interface ApprovedEntry {
  id: string;
  source: string;
  outletKey: string;
  region: string | null;
  territory: string | null;
  channel: string | null;
  customerType: string | null;
  contactName: string | null;
  contactPhone: string | null;
  latitude: number | null;
  longitude: number | null;
  repDecisions: RepDecision[];
}

export interface ApprovedDuplicate {
  id: string;
  aSource: string;
  aKey: string;
  bSource: string;
  bKey: string;
  decision: "MERGE" | "NOT_DUPLICATE";
}

export interface ApprovedOpen {
  source: string;
  outletKey: string;
  previousTeamLeader: string | null;
  status: "CLAIMED" | "CLOSED";
  claimedBy: string | null;
}

export interface ApprovedCleanup {
  entries: ApprovedEntry[];
  duplicates: ApprovedDuplicate[];
  open: ApprovedOpen[];
  /** Team leader of each rep code the approved rep decisions name. */
  repTeamLeader: Map<string, string>;
}

export const NO_APPROVED_CLEANUP: ApprovedCleanup = { entries: [], duplicates: [], open: [], repTeamLeader: new Map() };

export interface OverlayRow {
  source: string;
  outletKey: string;
  principal: string;
  region: string;
  territory: string;
  channel: string;
  segment: string;
  repCode: string | null;
  repName: string | null;
  teamLeader?: string | null;
  latitude: number | null;
  longitude: number | null;
  contactName?: string | null;
  contactPhone?: string | null;
}

/** The rows with the approved identification, GPS, reps and ownership laid over them. Run after the rep identity is set and before the matching and the universe cleanup read the rows. */
export function applyApprovedCleanup<T extends OverlayRow>(rows: readonly T[], approved: ApprovedCleanup): T[] {
  if (approved.entries.length === 0 && approved.open.length === 0) return [...rows];
  const entries = new Map(approved.entries.map((e) => [outletId(e.source, e.outletKey), e]));
  const open = new Map<string, ApprovedOpen[]>();
  for (const item of approved.open) open.set(outletId(item.source, item.outletKey), [...(open.get(outletId(item.source, item.outletKey)) ?? []), item]);

  return rows.map((row) => {
    const id = outletId(row.source, row.outletKey);
    const entry = entries.get(id);
    const settled = open.get(id);
    if (!entry && !settled) return row;
    const next: T = { ...row };
    if (entry) {
      if (entry.region) next.region = entry.region;
      if (entry.territory) next.territory = entry.territory;
      if (entry.channel) next.channel = entry.channel;
      if (entry.customerType) next.segment = entry.customerType;
      if (entry.contactName) next.contactName = entry.contactName;
      if (entry.contactPhone) next.contactPhone = entry.contactPhone;
      if (entry.latitude !== null && entry.longitude !== null) {
        next.latitude = entry.latitude;
        next.longitude = entry.longitude;
      }
      for (const decision of entry.repDecisions) {
        if (decision.action !== "CHANGED" || fold(decision.principal) !== fold(row.principal)) continue;
        next.repName = decision.rep;
        next.repCode = decision.repCode;
        const leader = decision.repCode ? approved.repTeamLeader.get(decision.repCode) : undefined;
        if (leader) next.teamLeader = leader;
      }
    }
    // Settled marked-open outlets, oldest first so a later decision wins: the rows the disowning team leader had move to the claimant, or to nobody.
    for (const item of settled ?? []) {
      if (fold(next.teamLeader) !== fold(item.previousTeamLeader) || fold(item.previousTeamLeader) === "") continue;
      next.teamLeader = item.status === "CLAIMED" ? item.claimedBy : null;
    }
    return next;
  });
}

/** The territory each approved outlet must carry as its unified name (the approved value is already a name from the universe's own list, so the unifier must not rename it). */
export function approvedTerritories(approved: ApprovedCleanup): Map<string, string> {
  const out = new Map<string, string>();
  for (const entry of approved.entries) if (entry.territory) out.set(outletId(entry.source, entry.outletKey), entry.territory);
  return out;
}

export interface ShopRow {
  source: string;
  outletKey: string;
  territoryClean?: string | null;
  shopId?: string | null;
  shopSize?: number | null;
  shopConfidence?: string | null;
}

/** Applies the approved territories and duplicate calls to rows that already carry the dedup's shops. A "not a duplicate" call separates the pair (the master outlet stays,
 *  the other leaves for its own shop); a "same shop" call joins the two shops (the one with the smaller id keeps the master). Joined shops are marked "Manual". */
export function applyShopDecisions<T extends ShopRow>(rows: readonly T[], approved: ApprovedCleanup): T[] {
  const territories = approvedTerritories(approved);
  const out: T[] = rows.map((row) => {
    const forced = territories.get(outletId(row.source, row.outletKey));
    return forced ? { ...row, territoryClean: forced } : { ...row };
  });
  if (approved.duplicates.length === 0) return out;

  // One shop id per outlet (every principal row of an outlet carries the same one).
  const shopOf = new Map<string, string>();
  for (const row of out) {
    const id = outletId(row.source, row.outletKey);
    if (row.shopId && !shopOf.has(id)) shopOf.set(id, row.shopId);
  }
  const affected = new Set<string>();
  // A shop is named after its master outlet's record key; an outlet on its own is its own master.
  const ownShop = (source: string, outletKey: string) => recordKey(OUTLET_SOURCE_LABELS[source as OutletSource] ?? source, outletKey);
  const isMaster = (id: string, shopId: string) => shopId === ownShop(id.split("|")[0], id.split("|").slice(1).join("|"));

  for (const d of approved.duplicates.filter((x) => x.decision === "NOT_DUPLICATE")) {
    const a = outletId(d.aSource, d.aKey);
    const b = outletId(d.bSource, d.bKey);
    const shopA = shopOf.get(a);
    if (!shopA || shopA !== shopOf.get(b)) continue;
    const leaving = isMaster(a, shopA) ? [b] : isMaster(b, shopA) ? [a] : [a, b];
    affected.add(shopA);
    for (const id of leaving) {
      const alone = ownShop(id.split("|")[0], id.split("|").slice(1).join("|"));
      shopOf.set(id, alone);
      affected.add(alone);
    }
  }

  // "Same shop": connect the shops of the two outlets, keep the smallest id as the shop's master.
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = parent.get(x) ?? x;
    while ((parent.get(root) ?? root) !== root) root = parent.get(root) ?? root;
    parent.set(x, root);
    return root;
  };
  const joined = new Set<string>();
  for (const d of approved.duplicates.filter((x) => x.decision === "MERGE")) {
    const a = outletId(d.aSource, d.aKey);
    const b = outletId(d.bSource, d.bKey);
    const shopA = shopOf.get(a) ?? ownShop(d.aSource, d.aKey);
    const shopB = shopOf.get(b) ?? ownShop(d.bSource, d.bKey);
    if (!shopOf.has(a) && !shopOf.has(b)) continue; // neither outlet is in the universe
    const rootA = find(shopA);
    const rootB = find(shopB);
    if (rootA === rootB) continue;
    const [keep, drop] = rootA < rootB ? [rootA, rootB] : [rootB, rootA];
    parent.set(drop, keep);
    joined.add(a);
    joined.add(b);
  }
  if (parent.size > 0) {
    for (const [id, shop] of [...shopOf.entries()]) {
      const root = find(shop);
      if (root !== shop) {
        shopOf.set(id, root);
        affected.add(root);
      }
    }
  }

  const members = new Map<string, Set<string>>();
  for (const [id, shop] of shopOf) (members.get(shop) ?? members.set(shop, new Set()).get(shop)!).add(id);
  return out.map((row) => {
    const id = outletId(row.source, row.outletKey);
    const shop = shopOf.get(id);
    if (!shop || (!affected.has(shop) && !affected.has(row.shopId ?? ""))) return row;
    const size = members.get(shop)?.size ?? 1;
    return { ...row, shopId: shop, shopSize: size, shopConfidence: size > 1 ? (joined.has(id) || row.shopId !== shop ? "Manual" : row.shopConfidence ?? null) : null };
  });
}
