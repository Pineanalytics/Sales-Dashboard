// Writes for the outlet cleanup: every function checks the person's scope and the rules in validate.ts, then saves the work in the cleanup tables with a log entry.
// Nothing here touches OutletUniverse: an admin validates and applies the work to the universe separately.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { OutletSource } from "@/lib/outletUniverse/normalize";
import { inActorScope, mayApprove, mayValidate } from "./access";
import { loadDisownTargets, loadOutletDetail, loadRepOptions, loadTeamLeaderOptions, type DisownTarget } from "./data";
import { describeDisownedRows, disownBlocker, filingTeamLeader, MAX_BULK_DISOWN, planDisown, type DisownPlan, type DisownRequest } from "./disown";
import { isPeriod } from "./progress";
import { checkGeoTag, cleanDraftInput, cleanVisitDays, planIdentification, type IdentificationRequest } from "./validate";
import { IDENTIFICATION_FIELDS, type CleanupActor, type IdentificationField, type LockableField, type OutletDetail, type RepDecision } from "./types";

export class CleanupError extends Error {
  constructor(
    message: string,
    public status: 400 | 403 | 404 | 409 = 400,
    public fields?: { field: string; message: string }[],
    /** Part of a combined save went through before the rest failed, so the form should reload what is now saved. */
    public partial = false
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
  return filingTeamLeader(actor, detail.reps.map((r) => ({ principal: r.principal, repName: r.rep, teamLeader: r.teamLeader, editable: r.editable })));
}

const unionLocks = (existing: readonly string[], add: readonly string[]) => [...new Set([...existing, ...add])] as LockableField[];

/** What a save by this person leaves the entry as: a rep's work waits for their team leader's approval, everyone else's for validation. */
const statusFor = (actor: CleanupActor) => (actor.role === "REP" ? "SUBMITTED" : "REVIEWED");

/** A rep's saves never lock a field (it is the team leader's approval that does); everyone else's lock what they settled. */
const locksFor = (actor: CleanupActor, existing: readonly string[] | undefined, add: readonly string[]) => (actor.role === "REP" ? ([...(existing ?? [])] as LockableField[]) : unionLocks(existing ?? [], add));

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
    const lockedFields = locksFor(actor, existing?.lockedFields, plan.lock);
    const entry = await tx.outletCleanupEntry.upsert({
      where: { source_outletKey: { source, outletKey } },
      create: {
        source,
        outletKey,
        outletName: detail.outletName,
        teamLeader: entryTeamLeader(actor, detail),
        status: statusFor(actor),
        submittedRole: actor.role,
        confirmedAsIs,
        ...plan.values,
        lockedFields,
        reviewedBy: actor.email,
        reviewedAt: now,
      },
      update: {
        ...plan.values,
        status: statusFor(actor), // a rejected entry goes back for approval or validation once it is reworked; a validated one is edited only by someone who may reopen it
        submittedRole: actor.role,
        approvedBy: null,
        approvedAt: null,
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
    const lockedFields = locksFor(actor, existing?.lockedFields, ["geo"]);
    const data = { latitude: tag.latitude, longitude: tag.longitude, geoAccuracyM: Math.round(tag.accuracyM), geoTaggedAt: now, geoTaggedBy: actor.email, lockedFields, status: statusFor(actor), submittedRole: actor.role, approvedBy: null, approvedAt: null, reviewedBy: actor.email, reviewedAt: now, checkedBy: null, checkedAt: null };
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
  /** The route this rep visits the outlet on (one of the row's route options) and the days of the week. */
  routeName?: string;
  visitDays?: string[];
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
    if (actor.role === "REP" && req.action === "CHANGE") {
      errors.push({ field: req.principal, message: "A sales rep confirms their own rows; ask your team leader to change the selling rep." });
      continue;
    }
    if (decided.has(row.principal.toLowerCase()) && !detail.canUnlock && actor.role !== "REP") {
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

    // The route and the visit days validated with the rep: the route must be one the row may be put on, the days must be weekdays.
    const made = next.get(row.principal.toLowerCase())!;
    const prior = decided.get(row.principal.toLowerCase());
    let routeName = prior?.routeName ?? null;
    let visitDays = prior?.visitDays;
    if (req.routeName !== undefined && req.routeName.trim() !== "") {
      const match = (detail.routing[row.principal]?.routeOptions ?? []).find((o) => o.toLowerCase() === req.routeName!.trim().toLowerCase());
      if (!match) {
        errors.push({ field: req.principal, message: "Choose a route from the list, or name a new route first." });
        continue;
      }
      routeName = match;
    }
    if (req.visitDays !== undefined && req.visitDays.length > 0) {
      const days = cleanVisitDays(req.visitDays);
      if (!days) {
        errors.push({ field: req.principal, message: "Choose the days from Monday to Sunday." });
        continue;
      }
      visitDays = days;
    }
    next.set(row.principal.toLowerCase(), { ...made, routeName, visitDays });
  }
  if (errors.length > 0) throw new CleanupError("Some reps could not be saved.", 400, errors);
  const decisions: RepDecision[] = [...next.values()];
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const existing = await tx.outletCleanupEntry.findUnique({ where: { source_outletKey: { source, outletKey } } });
    const data = { repDecisions: decisions as unknown as Prisma.InputJsonValue, lockedFields: locksFor(actor, existing?.lockedFields, ["reps"]), status: statusFor(actor), submittedRole: actor.role, approvedBy: null, approvedAt: null, reviewedBy: actor.email, reviewedAt: now, checkedBy: null, checkedAt: null };
    const saved = await tx.outletCleanupEntry.upsert({
      where: { source_outletKey: { source, outletKey } },
      create: { source, outletKey, outletName: detail.outletName, teamLeader: entryTeamLeader(actor, detail), ...data },
      update: data,
    });
    await writeLog(tx, actor, source, outletKey, "REP", { decisions: requests.map((r) => ({ principal: r.principal, action: r.action, repCode: r.repCode ?? null, routeName: r.routeName ?? null, visitDays: r.visitDays ?? null })) });
    return saved;
  });
}

/**
 * Keeps the person's unfinished work on an outlet ("Save draft"): the identification values typed and the rep / route / days chosen so far. Nothing is validated against the lists,
 * locked, logged as progress or shown to the admin; an empty draft removes the saved one. Private to the person who saved it.
 */
export async function saveDraft(actor: CleanupActor, source: OutletSource, outletKey: string, input: { set?: unknown; reps?: unknown }): Promise<{ cleared: boolean }> {
  const detail = await editableDetail(actor, source, outletKey);
  const decided = new Set(detail.repDecisions.map((d) => d.principal.toLowerCase()));
  const clean = cleanDraftInput(input, {
    identification: IDENTIFICATION_FIELDS.filter((f) => detail.canUnlock || !detail.lockedFields.includes(f)),
    principals: detail.reps.filter((r) => r.editable && (detail.canUnlock || !decided.has(r.principal.toLowerCase()))).map((r) => r.principal),
  });
  const where = { source_outletKey_savedBy: { source, outletKey, savedBy: actor.email } };
  if (Object.keys(clean.identification).length === 0 && clean.reps.length === 0) {
    await prisma.outletCleanupDraft.deleteMany({ where: { source, outletKey, savedBy: actor.email } });
    return { cleared: true };
  }
  const data = { identification: clean.identification as Prisma.InputJsonValue, reps: clean.reps as unknown as Prisma.InputJsonValue };
  await prisma.outletCleanupDraft.upsert({
    where,
    create: { source, outletKey, outletName: detail.outletName, savedBy: actor.email, teamLeader: entryTeamLeader(actor, detail), ...data },
    update: data,
  });
  return { cleared: false };
}

export async function discardDraft(actor: CleanupActor, source: OutletSource, outletKey: string) {
  await prisma.outletCleanupDraft.deleteMany({ where: { source, outletKey, savedBy: actor.email } });
}

/**
 * "Save final": commits the identification values and the rep / route / days rows together, exactly as saving them one by one would (fields lock, the outlet counts as reviewed and goes
 * to the admin), then drops the person's draft. If the reps are refused after the identification went through, the error says so and the draft is kept.
 */
export async function saveFinal(actor: CleanupActor, source: OutletSource, outletKey: string, request: { set?: Partial<Record<IdentificationField, string>>; reps?: RepRequest[] }) {
  const identification = Object.keys(request.set ?? {}).length > 0;
  const reps = request.reps ?? [];
  if (!identification && reps.length === 0) throw new CleanupError("Nothing to save.", 400);
  if (identification) await saveIdentification(actor, source, outletKey, { set: request.set });
  if (reps.length > 0) {
    try {
      await decideReps(actor, source, outletKey, reps);
    } catch (error) {
      if (identification && error instanceof CleanupError) throw new CleanupError(`The details were saved, but the reps were not. ${error.message}`, error.status, error.fields, true);
      throw error;
    }
  }
  await discardDraft(actor, source, outletKey);
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

interface DisownFiling {
  source: OutletSource;
  outletKey: string;
  outletName: string;
  principals: string;
  territory: string | null;
  region: string | null;
  previousTeamLeader: string | null;
  previousReps: string | null;
}

/** Files one outlet on the marked-open list. With named owners it waits for their answers (OPEN); with the owner unknown there is nobody to ask, so it is UNCLAIMED and an admin allocates it. */
async function fileMarkedOpen(tx: Tx, actor: CleanupActor, filing: DisownFiling, plan: Extract<DisownPlan, { ok: true }>) {
  const open = await tx.markedOpenOutlet.create({
    data: {
      ...filing,
      reason: plan.reason.slice(0, 300),
      markedBy: actor.email,
      status: plan.ownerUnknown ? "UNCLAIMED" : "OPEN",
      candidates: { create: plan.candidates.map((teamLeader) => ({ teamLeader })) },
    },
    include: { candidates: true },
  });
  await writeLog(tx, actor, filing.source, filing.outletKey, "DISOWN", { reason: plan.reason, candidates: plan.candidates, ownerUnknown: plan.ownerUnknown });
  return open;
}

const planOrThrow = (request: DisownRequest, options: readonly string[]) => {
  const plan = planDisown(request, options);
  if (!plan.ok) throw new CleanupError(plan.message, 400, plan.fields);
  return plan;
};

/** Disowns an outlet: it goes to the marked-open list with the possible owners from other teams, who then claim or decline it, or with the owner declared unknown for an admin to allocate. */
export async function disownOutlet(actor: CleanupActor, source: OutletSource, outletKey: string, request: DisownRequest) {
  const detail = await editableDetail(actor, source, outletKey);
  const plan = planOrThrow(request, detail.teamLeaderOptions);
  const rows = detail.reps.map((r) => ({ principal: r.principal, repName: r.rep, teamLeader: r.teamLeader, editable: r.editable }));
  const { principals, previousReps } = describeDisownedRows(rows);
  return prisma.$transaction((tx) =>
    fileMarkedOpen(tx, actor, { source, outletKey, outletName: detail.outletName, principals, territory: detail.verified.territory ?? detail.current.territory, region: detail.verified.region ?? detail.current.region, previousTeamLeader: entryTeamLeader(actor, detail), previousReps }, plan)
  );
}

/**
 * Disowns many outlets with one reason and one answer to "who may own them" (named team leaders, or the owner unknown). Outlets that cannot be disowned (not the person's, already marked
 * open) are skipped and reported; the rest are filed together, so a failure leaves none half-done.
 */
export async function disownOutlets(actor: CleanupActor, items: { source: OutletSource; outletKey: string }[], request: DisownRequest) {
  if (!actor.canReview) throw new CleanupError("You cannot edit these outlets.", 403);
  const unique = [...new Map(items.map((i) => [`${i.source}|${i.outletKey}`, i])).values()];
  if (unique.length === 0) throw new CleanupError("Choose at least one outlet.", 400);
  if (unique.length > MAX_BULK_DISOWN) throw new CleanupError(`Disown at most ${MAX_BULK_DISOWN} outlets at a time.`, 400);
  const options = (await loadTeamLeaderOptions()).filter((n) => !actor.teamLeaders?.some((mine) => mine.toLowerCase() === n.toLowerCase()));
  const plan = planOrThrow(request, options);

  const targets = await loadDisownTargets(actor, unique);
  const skipped: { source: OutletSource; outletKey: string; outletName: string; reason: string }[] = [];
  const eligible: DisownTarget[] = [];
  for (const item of unique) {
    const target = targets.get(`${item.source}|${item.outletKey}`);
    const blocker = disownBlocker(target);
    if (blocker || !target) skipped.push({ ...item, outletName: target?.outletName ?? item.outletKey, reason: blocker ?? "Not one of your outlets." });
    else eligible.push(target);
  }
  if (eligible.length === 0) {
    throw new CleanupError("None of the chosen outlets can be disowned.", 409, skipped.slice(0, 10).map((s) => ({ field: s.outletKey, message: `${s.outletName}: ${s.reason}` })));
  }
  await prisma.$transaction(
    async (tx) => {
      for (const target of eligible) {
        const { principals, previousReps } = describeDisownedRows(target.rows);
        await fileMarkedOpen(tx, actor, { source: target.source, outletKey: target.outletKey, outletName: target.outletName, principals, territory: target.territory, region: target.region, previousTeamLeader: filingTeamLeader(actor, target.rows), previousReps }, plan);
      }
    },
    { timeout: 60_000 }
  );
  return { count: eligible.length, skipped, ownerUnknown: plan.ownerUnknown };
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

/** An admin settles a marked-open outlet nobody claimed (or that has waited too long): allocates it to a team leader, or closes it. */
export async function resolveOpenOutlet(actor: CleanupActor, openId: string, request: { decision: "ASSIGN" | "CLOSE"; teamLeader?: string; note?: string }) {
  if (!actor.isAdmin) throw new CleanupError("Only an admin can settle a marked-open outlet.", 403);
  const open = await prisma.markedOpenOutlet.findUnique({ where: { id: openId } });
  if (!open) throw new CleanupError("That open outlet was not found.", 404);
  if (open.status === "CLAIMED" || open.status === "CLOSED") throw new CleanupError("This outlet has already been settled.", 409);
  const note = request.note?.trim().slice(0, 300) || null;
  let teamLeader: string | null = null;
  if (request.decision === "ASSIGN") {
    const known = new Map((await loadTeamLeaderOptions()).map((n) => [n.toLowerCase(), n]));
    teamLeader = known.get((request.teamLeader ?? "").trim().toLowerCase()) ?? null;
    if (!teamLeader) throw new CleanupError("Choose the team leader who takes the outlet from the list.", 400, [{ field: "teamLeader", message: "Choose a team leader." }]);
  } else if (!note) {
    throw new CleanupError("Say why the outlet is being closed.", 400, [{ field: "note", message: "Give a short reason." }]);
  }
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const saved = await tx.markedOpenOutlet.update({
      where: { id: open.id },
      data: request.decision === "ASSIGN" ? { status: "CLAIMED", claimedBy: teamLeader, claimedAt: now, resolvedBy: actor.email, resolvedAt: now, resolutionNote: note } : { status: "CLOSED", resolvedBy: actor.email, resolvedAt: now, resolutionNote: note },
    });
    await writeLog(tx, actor, open.source, open.outletKey, request.decision === "ASSIGN" ? "OPEN_ASSIGNED" : "OPEN_CLOSED", { teamLeader, note });
    return saved;
  });
}

/** An admin sets the share of outlets that must be reviewed by the end of a month: for everyone ("*") or for one team leader. */
export async function setCleanupTarget(actor: CleanupActor, request: { period: string; teamLeader: string; targetPct: number }) {
  if (!actor.isAdmin) throw new CleanupError("Only an admin can set targets.", 403);
  if (!isPeriod(request.period)) throw new CleanupError("Choose a month.", 400, [{ field: "period", message: "Use the form 2026-11." }]);
  if (!Number.isFinite(request.targetPct) || request.targetPct < 1 || request.targetPct > 100) throw new CleanupError("A target is between 1% and 100%.", 400, [{ field: "targetPct", message: "Enter 1 to 100." }]);
  let teamLeader = "*";
  if (request.teamLeader !== "*") {
    const known = new Map((await loadTeamLeaderOptions()).map((n) => [n.toLowerCase(), n]));
    const match = known.get(request.teamLeader.trim().toLowerCase());
    if (!match) throw new CleanupError("Choose a team leader from the list.", 400, [{ field: "teamLeader", message: "Choose a team leader." }]);
    teamLeader = match;
  }
  const targetPct = Math.round(request.targetPct * 10) / 10;
  const saved = await prisma.cleanupTarget.upsert({
    where: { period_teamLeader: { period: request.period, teamLeader } },
    create: { period: request.period, teamLeader, targetPct, setBy: actor.email },
    update: { targetPct, setBy: actor.email },
  });
  await prisma.outletCleanupLog.create({ data: { source: "-", outletKey: `${request.period}|${teamLeader}`, action: "TARGET", actor: actor.email, actorRole: actor.role, changes: { targetPct } } });
  return saved;
}

/** Removes a team leader's own target for a month, so they fall back to the default. */
export async function clearCleanupTarget(actor: CleanupActor, request: { period: string; teamLeader: string }) {
  if (!actor.isAdmin) throw new CleanupError("Only an admin can set targets.", 403);
  if (!isPeriod(request.period) || request.teamLeader === "*") throw new CleanupError("Nothing to clear.", 400);
  await prisma.cleanupTarget.deleteMany({ where: { period: request.period, teamLeader: request.teamLeader } });
}

/** An admin validates or rejects entries the teams have saved. Validated entries are laid over the universe at the next compile; a rejected one is sent back with its fields unlocked and its rep decisions cleared. */
export async function reviewEntries(actor: CleanupActor, request: { ids: string[]; decision: "VALIDATE" | "REJECT"; note?: string }) {
  if (!mayValidate(actor)) throw new CleanupError("Only an admin, or a supervisor for their own team leaders, can validate or reject cleanup entries.", 403);
  const ids = [...new Set(request.ids)].slice(0, 500);
  if (ids.length === 0) throw new CleanupError("Choose at least one entry.", 400);
  const note = request.note?.trim().slice(0, 300) || null;
  if (request.decision === "REJECT" && !note) throw new CleanupError("Say what the team leader should correct.", 400, [{ field: "note", message: "Give a short reason." }]);
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const candidates = await tx.outletCleanupEntry.findMany({ where: { id: { in: ids }, status: request.decision === "VALIDATE" ? "REVIEWED" : { in: ["REVIEWED", "VALIDATED"] } }, select: { id: true, source: true, outletKey: true, teamLeader: true, reviewedBy: true } });
    // A supervisor works on the team leaders under them, and never validates their own work.
    const found = actor.isAdmin ? candidates : candidates.filter((c) => inActorScope(actor, c.teamLeader) && c.reviewedBy !== actor.email);
    if (found.length === 0) throw new CleanupError("Those entries are no longer waiting for review.", 409);
    const where = { id: { in: found.map((f) => f.id) } };
    if (request.decision === "VALIDATE") await tx.outletCleanupEntry.updateMany({ where, data: { status: "VALIDATED", checkedBy: actor.email, checkedAt: now, adminNote: note } });
    else await tx.outletCleanupEntry.updateMany({ where, data: { status: "REJECTED", checkedBy: actor.email, checkedAt: now, adminNote: note, lockedFields: [], repDecisions: Prisma.DbNull } });
    await tx.outletCleanupLog.createMany({ data: found.map((f) => ({ source: f.source, outletKey: f.outletKey, action: request.decision === "VALIDATE" ? "VALIDATE" : "REJECT", actor: actor.email, actorRole: actor.role, changes: note ? { note } : Prisma.JsonNull })) });
    return { count: found.length, skipped: ids.length - found.length };
  });
}

/** The same for the duplicate calls: a validated "same shop" or "not a duplicate" is applied to the shops at the next compile. */
export async function reviewDuplicates(actor: CleanupActor, request: { ids: string[]; decision: "VALIDATE" | "REJECT"; note?: string }) {
  if (!actor.isAdmin) throw new CleanupError("Only an admin can validate or reject duplicate calls.", 403);
  const ids = [...new Set(request.ids)].slice(0, 500);
  if (ids.length === 0) throw new CleanupError("Choose at least one decision.", 400);
  const note = request.note?.trim().slice(0, 300) || null;
  if (request.decision === "REJECT" && !note) throw new CleanupError("Say why the call is rejected.", 400, [{ field: "note", message: "Give a short reason." }]);
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const found = await tx.outletDuplicateDecision.findMany({ where: { id: { in: ids }, status: request.decision === "VALIDATE" ? "REVIEWED" : { in: ["REVIEWED", "VALIDATED"] } }, select: { id: true, aSource: true, aKey: true } });
    if (found.length === 0) throw new CleanupError("Those decisions are no longer waiting for review.", 409);
    await tx.outletDuplicateDecision.updateMany({ where: { id: { in: found.map((f) => f.id) } }, data: { status: request.decision === "VALIDATE" ? "VALIDATED" : "REJECTED", checkedBy: actor.email, checkedAt: now, ...(note ? { note } : {}) } });
    await tx.outletCleanupLog.createMany({ data: found.map((f) => ({ source: f.aSource, outletKey: f.aKey, action: request.decision === "VALIDATE" ? "VALIDATE" : "REJECT", actor: actor.email, actorRole: actor.role, changes: { duplicateDecision: f.id, note } })) });
    return { count: found.length, skipped: ids.length - found.length };
  });
}

/**
 * A team leader (or a supervisor over them, or an admin) approves or sends back what a sales rep submitted. Approving makes it the team's work: the fields the rep settled lock, it
 * counts as progress and it goes on to validation. Sending back needs a reason, clears the rep's decisions and lets the rep work on it again.
 */
export async function approveSubmissions(actor: CleanupActor, request: { ids: string[]; decision: "APPROVE" | "SEND_BACK"; note?: string }) {
  if (!mayApprove(actor)) throw new CleanupError("Only a team leader, a supervisor or an admin can approve a rep's work.", 403);
  const ids = [...new Set(request.ids)].slice(0, 500);
  if (ids.length === 0) throw new CleanupError("Choose at least one entry.", 400);
  const note = request.note?.trim().slice(0, 300) || null;
  if (request.decision === "SEND_BACK" && !note) throw new CleanupError("Say what the rep should correct.", 400, [{ field: "note", message: "Give a short reason." }]);
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const rows = await tx.outletCleanupEntry.findMany({ where: { id: { in: ids }, status: "SUBMITTED" } });
    const mine = actor.isAdmin ? rows : rows.filter((r) => inActorScope(actor, r.teamLeader));
    if (mine.length === 0) throw new CleanupError("Those submissions are no longer waiting for approval.", 409);
    for (const row of mine) {
      if (request.decision === "APPROVE") {
        const locks = new Set<string>(row.lockedFields);
        for (const field of IDENTIFICATION_FIELDS) if (row[field]) locks.add(field);
        if (row.latitude !== null) locks.add("geo");
        if (Array.isArray(row.repDecisions) && row.repDecisions.length > 0) locks.add("reps");
        await tx.outletCleanupEntry.update({ where: { id: row.id }, data: { status: "REVIEWED", approvedBy: actor.email, approvedAt: now, adminNote: note, lockedFields: [...locks] } });
      } else {
        await tx.outletCleanupEntry.update({ where: { id: row.id }, data: { status: "REJECTED", checkedBy: actor.email, checkedAt: now, adminNote: note, lockedFields: [], repDecisions: Prisma.DbNull, approvedBy: null, approvedAt: null } });
      }
    }
    await tx.outletCleanupLog.createMany({
      data: mine.map((r) => ({ source: r.source, outletKey: r.outletKey, action: request.decision, actor: actor.email, actorRole: actor.role, changes: note ? { note } : Prisma.JsonNull })),
    });
    return { count: mine.length, skipped: ids.length - mine.length };
  });
}
