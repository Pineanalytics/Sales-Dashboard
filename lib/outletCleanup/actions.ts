// Writes for the outlet cleanup: every function checks the person's scope and the rules in validate.ts, then saves the work in the cleanup tables with a log entry.
// Nothing here touches OutletUniverse: an admin validates and applies the work to the universe separately.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { OutletSource } from "@/lib/outletUniverse/normalize";
import { inActorScope } from "./access";
import { loadOutletDetail, loadRepOptions } from "./data";
import { checkGeoTag, planIdentification, type IdentificationRequest } from "./validate";
import type { CleanupActor, IdentificationField, LockableField, OutletDetail, RepDecision } from "./types";

export class CleanupError extends Error {
  constructor(
    message: string,
    public status: 400 | 403 | 404 | 409 = 400,
    public fields?: { field: string; message: string }[]
  ) {
    super(message);
  }
}

type Tx = Prisma.TransactionClient;

async function writeLog(tx: Tx, actor: CleanupActor, source: string, outletKey: string, action: string, changes: Prisma.InputJsonValue | null) {
  await tx.outletCleanupLog.create({ data: { source, outletKey, action, actor: actor.email, actorRole: actor.role, changes: changes ?? Prisma.JsonNull } });
}

async function editableDetail(actor: CleanupActor, source: OutletSource, outletKey: string): Promise<OutletDetail> {
  const detail = await loadOutletDetail(actor, source, outletKey);
  if (!detail) throw new CleanupError("That outlet is not one you work on.", 404);
  if (detail.state === "DISOWNED") throw new CleanupError("This outlet has been marked open; it can no longer be edited here.", 409);
  if (!detail.canEdit) throw new CleanupError("You cannot edit this outlet.", 403);
  return detail;
}

/** The team leader an entry is filed under: the actor's own team for a team leader, otherwise the first team that sells the outlet. */
function entryTeamLeader(actor: CleanupActor, detail: OutletDetail): string | null {
  if (actor.role === "TEAM_LEADER") return actor.teamLeaders?.[0] ?? null;
  const row = detail.reps.find((r) => r.editable && r.teamLeader);
  return row?.teamLeader ?? actor.displayName;
}

const unionLocks = (existing: readonly string[], add: readonly string[]) => [...new Set([...existing, ...add])] as LockableField[];

/** Saves updated identification values and/or confirmations (including "mark all correct"); locks the fields it settles. */
export async function saveIdentification(actor: CleanupActor, source: OutletSource, outletKey: string, request: IdentificationRequest) {
  const detail = await editableDetail(actor, source, outletKey);
  if (request.confirm === "ALL" && detail.geo.missing && !detail.lockedFields.includes("geo")) {
    throw new CleanupError("This outlet has no GPS point. Visit it and tag its location before marking everything correct.", 400, [{ field: "geo", message: "Tag the location first." }]);
  }
  const plan = planIdentification({ current: detail.current, verified: detail.verified, locked: detail.lockedFields, request, options: detail.options, canUnlock: detail.canUnlock });
  if (plan.errors.length > 0) throw new CleanupError("Some details could not be saved.", 400, plan.errors);
  if (Object.keys(plan.values).length === 0 && plan.lock.length === 0) throw new CleanupError("Nothing to save.", 400);

  const confirmedAsIs = request.confirm === "ALL" && Object.keys(plan.values).length === 0 && Object.keys(detail.verified).length === 0;
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const existing = await tx.outletCleanupEntry.findUnique({ where: { source_outletKey: { source, outletKey } } });
    const lockedFields = unionLocks(existing?.lockedFields ?? [], plan.lock);
    const entry = await tx.outletCleanupEntry.upsert({
      where: { source_outletKey: { source, outletKey } },
      create: {
        source,
        outletKey,
        outletName: detail.outletName,
        teamLeader: entryTeamLeader(actor, detail),
        status: "REVIEWED",
        confirmedAsIs,
        ...plan.values,
        lockedFields,
        reviewedBy: actor.email,
        reviewedAt: now,
      },
      update: {
        ...plan.values,
        status: "REVIEWED", // a rejected entry goes back to the admin once it is reworked; a validated one is edited only by someone who may reopen it
        confirmedAsIs: existing?.confirmedAsIs ? existing.confirmedAsIs && Object.keys(plan.values).length === 0 : confirmedAsIs,
        lockedFields,
        reviewedBy: actor.email,
        reviewedAt: now,
        checkedBy: null,
        checkedAt: null,
      },
    });
    const changes: Record<string, { from: string | null; to: string }> = {};
    for (const field of Object.keys(plan.values) as IdentificationField[]) changes[field] = { from: detail.verified[field] ?? detail.current[field] ?? null, to: plan.values[field] as string };
    await writeLog(tx, actor, source, outletKey, request.confirm === "ALL" ? "CONFIRM_ALL" : "SAVE", { changes, locked: plan.lock });
    return entry;
  });
}

/** Records the outlet's GPS point from a phone at the outlet. */
export async function tagGeo(actor: CleanupActor, source: OutletSource, outletKey: string, tag: { latitude: number; longitude: number; accuracyM: number }) {
  const detail = await editableDetail(actor, source, outletKey);
  if (detail.lockedFields.includes("geo") && !detail.canUnlock) throw new CleanupError("This outlet's location has already been tagged and is locked. Ask your supervisor or an admin to reopen it.", 409);
  const check = checkGeoTag(tag, { latitude: detail.geo.latitude, longitude: detail.geo.longitude });
  if (!check.ok) throw new CleanupError(check.error, 400, [{ field: "geo", message: check.error }]);
  const now = new Date();
  const entry = await prisma.$transaction(async (tx) => {
    const existing = await tx.outletCleanupEntry.findUnique({ where: { source_outletKey: { source, outletKey } } });
    const lockedFields = unionLocks(existing?.lockedFields ?? [], ["geo"]);
    const data = { latitude: tag.latitude, longitude: tag.longitude, geoAccuracyM: Math.round(tag.accuracyM), geoTaggedAt: now, geoTaggedBy: actor.email, lockedFields, status: "REVIEWED", reviewedBy: actor.email, reviewedAt: now, checkedBy: null, checkedAt: null };
    const saved = await tx.outletCleanupEntry.upsert({
      where: { source_outletKey: { source, outletKey } },
      create: { source, outletKey, outletName: detail.outletName, teamLeader: entryTeamLeader(actor, detail), ...data },
      update: data,
    });
    await writeLog(tx, actor, source, outletKey, "GEO_TAG", { from: [detail.geo.latitude, detail.geo.longitude], to: [tag.latitude, tag.longitude], accuracyM: Math.round(tag.accuracyM), distanceM: check.distanceM, farFromPrevious: check.farFromPrevious });
    return saved;
  });
  return { entry, distanceM: check.distanceM, farFromPrevious: check.farFromPrevious };
}

export interface RepRequest {
  principal: string;
  /** CONFIRM keeps the rep the universe has; CHANGE needs `repCode` from the principal's rep list. */
  action: "CONFIRM" | "CHANGE";
  repCode?: string;
}

/** Validates the selling rep of each principal, or changes it to a rep from the synced roster. */
export async function decideReps(actor: CleanupActor, source: OutletSource, outletKey: string, requests: RepRequest[]) {
  const detail = await editableDetail(actor, source, outletKey);
  if (requests.length === 0) throw new CleanupError("Nothing to save.", 400);
  const options = await loadRepOptions(detail.reps.map((r) => r.principal));
  const decided = new Map(detail.repDecisions.map((d) => [d.principal.toLowerCase(), d]));
  const next = new Map(decided);
  const errors: { field: string; message: string }[] = [];
  for (const req of requests) {
    const row = detail.reps.find((r) => r.principal.toLowerCase() === req.principal.toLowerCase());
    if (!row || !row.editable) {
      errors.push({ field: req.principal, message: "You cannot change the rep of this principal: it is not on your team." });
      continue;
    }
    if (decided.has(row.principal.toLowerCase()) && !detail.canUnlock) {
      errors.push({ field: req.principal, message: "The rep of this principal was already validated, so it is locked." });
      continue;
    }
    if (req.action === "CONFIRM") {
      if (!row.rep) {
        errors.push({ field: req.principal, message: "No rep is on record for this principal. Choose the rep who sells it." });
        continue;
      }
      next.set(row.principal.toLowerCase(), { principal: row.principal, rep: row.rep, repCode: row.repCode, previousRep: row.rep, action: "CONFIRMED" });
    } else {
      const choice = (options[row.principal] ?? []).find((o) => o.code === req.repCode);
      if (!choice) {
        errors.push({ field: req.principal, message: "Choose a rep from the list of this principal's synced reps." });
        continue;
      }
      next.set(row.principal.toLowerCase(), { principal: row.principal, rep: choice.name, repCode: choice.code, previousRep: row.rep, action: row.rep && row.rep.toLowerCase() === choice.name.toLowerCase() ? "CONFIRMED" : "CHANGED" });
    }
  }
  if (errors.length > 0) throw new CleanupError("Some reps could not be saved.", 400, errors);
  const decisions: RepDecision[] = [...next.values()];
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const existing = await tx.outletCleanupEntry.findUnique({ where: { source_outletKey: { source, outletKey } } });
    const data = { repDecisions: decisions as unknown as Prisma.InputJsonValue, lockedFields: unionLocks(existing?.lockedFields ?? [], ["reps"]), status: "REVIEWED", reviewedBy: actor.email, reviewedAt: now, checkedBy: null, checkedAt: null };
    const saved = await tx.outletCleanupEntry.upsert({
      where: { source_outletKey: { source, outletKey } },
      create: { source, outletKey, outletName: detail.outletName, teamLeader: entryTeamLeader(actor, detail), ...data },
      update: data,
    });
    await writeLog(tx, actor, source, outletKey, "REP", { decisions: requests.map((r) => ({ principal: r.principal, action: r.action, repCode: r.repCode ?? null })) });
    return saved;
  });
}

/** A team leader's call on a pair of outlets: the same shop (merge) or not. */
export async function decideDuplicate(actor: CleanupActor, source: OutletSource, outletKey: string, request: { otherSource: OutletSource; otherKey: string; decision: "MERGE" | "NOT_DUPLICATE"; note?: string }) {
  const detail = await editableDetail(actor, source, outletKey);
  const other = detail.duplicates.find((d) => d.source === request.otherSource && d.outletKey === request.otherKey);
  if (!other) throw new CleanupError("That outlet is not among this outlet's possible duplicates.", 400);
  if (other.decision && !detail.canUnlock) throw new CleanupError("You already decided on this pair. Ask your supervisor or an admin to reopen it.", 409);
  const [a, b] = [`${source}|${outletKey}`, `${request.otherSource}|${request.otherKey}`].sort();
  const [aSource, aKey] = a.split("|");
  const [bSource, bKey] = [b.slice(0, b.indexOf("|")), b.slice(b.indexOf("|") + 1)];
  const aKeyFull = a.slice(a.indexOf("|") + 1);
  void aKey;
  const note = request.note?.trim().slice(0, 300) || null;
  return prisma.$transaction(async (tx) => {
    const saved = await tx.outletDuplicateDecision.upsert({
      where: { aSource_aKey_bSource_bKey: { aSource, aKey: aKeyFull, bSource, bKey } },
      create: { aSource, aKey: aKeyFull, bSource, bKey, decision: request.decision, status: "REVIEWED", teamLeader: entryTeamLeader(actor, detail), decidedBy: actor.email, note },
      update: { decision: request.decision, status: "REVIEWED", teamLeader: entryTeamLeader(actor, detail), decidedBy: actor.email, decidedAt: new Date(), note, checkedBy: null, checkedAt: null },
    });
    await writeLog(tx, actor, source, outletKey, "DUPLICATE", { other: `${request.otherSource} ${request.otherKey}`, decision: request.decision, inSameShop: other.inSameShop });
    return saved;
  });
}

/** Disowns an outlet: it goes to the marked-open list with the possible owners from other teams, who then claim or decline it. */
export async function disownOutlet(actor: CleanupActor, source: OutletSource, outletKey: string, request: { reason: string; candidates: string[] }) {
  const detail = await editableDetail(actor, source, outletKey);
  const reason = request.reason.trim();
  if (reason.length < 5) throw new CleanupError("Say why the outlet is being disowned.", 400, [{ field: "reason", message: "Give a short reason." }]);
  const allowed = new Map(detail.teamLeaderOptions.map((n) => [n.toLowerCase(), n]));
  const candidates = [...new Set(request.candidates.map((c) => allowed.get(c.trim().toLowerCase())).filter((c): c is string => Boolean(c)))];
  if (candidates.length === 0) throw new CleanupError("Name at least one possible owner from another team before disowning.", 400, [{ field: "candidates", message: "Choose one or more team leaders from other teams." }]);
  const principals = [...new Set(detail.reps.map((r) => r.principal))].join(", ");
  const previousReps = detail.reps.filter((r) => r.rep).map((r) => `${r.principal}: ${r.rep}`).join("; ") || null;
  return prisma.$transaction(async (tx) => {
    const open = await tx.markedOpenOutlet.create({
      data: {
        source,
        outletKey,
        outletName: detail.outletName,
        principals,
        territory: detail.verified.territory ?? detail.current.territory,
        region: detail.verified.region ?? detail.current.region,
        previousTeamLeader: entryTeamLeader(actor, detail),
        previousReps,
        reason: reason.slice(0, 300),
        markedBy: actor.email,
        candidates: { create: candidates.map((teamLeader) => ({ teamLeader })) },
      },
      include: { candidates: true },
    });
    await writeLog(tx, actor, source, outletKey, "DISOWN", { reason, candidates });
    return open;
  });
}

/** A named team leader claims a marked-open outlet or declines it. */
export async function respondToOpenOutlet(actor: CleanupActor, openId: string, request: { response: "CLAIM" | "DECLINE"; teamLeader: string; note?: string }) {
  const open = await prisma.markedOpenOutlet.findUnique({ where: { id: openId }, include: { candidates: true } });
  if (!open) throw new CleanupError("That open outlet was not found.", 404);
  if (open.status !== "OPEN") throw new CleanupError("This outlet has already been settled.", 409);
  const candidate = open.candidates.find((c) => c.teamLeader.toLowerCase() === request.teamLeader.trim().toLowerCase());
  if (!candidate) throw new CleanupError("That team leader was not named as a possible owner.", 400);
  if (!inActorScope(actor, candidate.teamLeader) && !actor.isAdmin) throw new CleanupError("You can only answer for your own team.", 403);
  if (candidate.response !== "PENDING") throw new CleanupError("That team already answered.", 409);
  const note = request.note?.trim().slice(0, 300) || null;
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    await tx.markedOpenCandidate.update({ where: { id: candidate.id }, data: { response: request.response === "CLAIM" ? "CLAIMED" : "DECLINED", respondedAt: now, respondedBy: actor.email, note } });
    if (request.response === "CLAIM") {
      await tx.markedOpenOutlet.update({ where: { id: open.id }, data: { status: "CLAIMED", claimedBy: candidate.teamLeader, claimedAt: now } });
      await tx.markedOpenCandidate.updateMany({ where: { openId: open.id, response: "PENDING" }, data: { response: "DECLINED", respondedAt: now, respondedBy: "system: claimed by " + candidate.teamLeader } });
    } else {
      const stillWaiting = open.candidates.filter((c) => c.id !== candidate.id && c.response === "PENDING").length;
      if (stillWaiting === 0) await tx.markedOpenOutlet.update({ where: { id: open.id }, data: { status: "UNCLAIMED" } });
    }
    await writeLog(tx, actor, open.source, open.outletKey, request.response === "CLAIM" ? "CLAIM" : "DECLINE", { teamLeader: candidate.teamLeader, note });
    return tx.markedOpenOutlet.findUnique({ where: { id: open.id }, include: { candidates: true } });
  });
}

/** An admin or a supervisor reopens fields a team leader has locked. */
export async function unlockFields(actor: CleanupActor, source: OutletSource, outletKey: string, fields: LockableField[]) {
  if (!(actor.isAdmin || actor.role === "SUPERVISOR")) throw new CleanupError("Only a supervisor or an admin can reopen a locked field.", 403);
  const detail = await loadOutletDetail(actor, source, outletKey);
  if (!detail) throw new CleanupError("That outlet is not one you work on.", 404);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.outletCleanupEntry.findUnique({ where: { source_outletKey: { source, outletKey } } });
    if (!existing) throw new CleanupError("Nothing is locked on this outlet.", 404);
    const remaining = existing.lockedFields.filter((f) => !fields.includes(f as LockableField));
    const reopenedReps = fields.includes("reps");
    const saved = await tx.outletCleanupEntry.update({ where: { id: existing.id }, data: { lockedFields: remaining, ...(reopenedReps ? { repDecisions: Prisma.JsonNull } : {}) } });
    await writeLog(tx, actor, source, outletKey, "UNLOCK", { fields });
    return saved;
  });
}
