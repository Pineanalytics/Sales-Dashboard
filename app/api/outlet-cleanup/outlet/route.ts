import { NextRequest, NextResponse } from "next/server";
import { resolveCleanupActor } from "@/lib/outletCleanup/access";
import { CleanupError, decideDuplicate, decideReps, discardDraft, disownOutlet, saveDraft, saveFinal, saveIdentification, tagGeo, unlockFields, type RepRequest } from "@/lib/outletCleanup/actions";
import { loadOutletDetail } from "@/lib/outletCleanup/data";
import { IDENTIFICATION_FIELDS, type IdentificationField, type LockableField } from "@/lib/outletCleanup/types";
import { OUTLET_SOURCES, type OutletSource } from "@/lib/outletUniverse/normalize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LOCKABLE: readonly string[] = [...IDENTIFICATION_FIELDS, "geo", "reps"];

const asSource = (value: unknown): OutletSource | null => ((OUTLET_SOURCES as string[]).includes(String(value)) ? (value as OutletSource) : null);
const asKey = (value: unknown): string | null => (typeof value === "string" && value.length > 0 && value.length <= 200 ? value : null);
const asText = (value: unknown, max: number): string => (typeof value === "string" ? value.slice(0, max) : "");
const asNumber = (value: unknown): number => (typeof value === "number" ? value : Number.NaN);

const asSet = (value: unknown): Partial<Record<IdentificationField, string>> => {
  const set: Partial<Record<IdentificationField, string>> = {};
  if (value && typeof value === "object") {
    for (const field of IDENTIFICATION_FIELDS) {
      const v = (value as Record<string, unknown>)[field];
      if (typeof v === "string") set[field] = v.slice(0, 120);
    }
  }
  return set;
};

const asReps = (value: unknown): RepRequest[] =>
  Array.isArray(value)
    ? value.slice(0, 20).map((r: Record<string, unknown>) => ({
        principal: asText(r?.principal, 120),
        action: r?.action === "CHANGE" ? ("CHANGE" as const) : ("CONFIRM" as const),
        repCode: asText(r?.repCode, 60) || undefined,
        routeName: asText(r?.routeName, 120) || undefined,
        visitDays: Array.isArray(r?.visitDays) ? r.visitDays.slice(0, 7).map((d: unknown) => asText(d, 12)) : undefined,
      }))
    : [];

type Denied = NextResponse<{ error: string }>;
async function actorOr403(): Promise<{ actor: import("@/lib/outletCleanup/types").CleanupActor } | { denied: Denied }> {
  const access = await resolveCleanupActor();
  if (access.ok) return { actor: access.actor };
  return { denied: NextResponse.json({ error: access.status === 401 ? "Sign in required." : "The outlet cleanup is for team leaders and supervisors." }, { status: access.status }) };
}

/** One outlet in full: the values to verify, the lists to choose from, the reps, the possible duplicates and the history. */
export async function GET(req: NextRequest) {
  const who = await actorOr403();
  if ("denied" in who) return who.denied;
  const source = asSource(req.nextUrl.searchParams.get("source"));
  const key = asKey(req.nextUrl.searchParams.get("key"));
  if (!source || !key) return NextResponse.json({ error: "Name the outlet's system and key." }, { status: 400 });
  try {
    const detail = await loadOutletDetail(who.actor, source, key);
    if (!detail) return NextResponse.json({ error: "That outlet is not one you work on." }, { status: 404 });
    return NextResponse.json(detail, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Failed to load the outlet for cleanup", error);
    return NextResponse.json({ error: "Failed to load the outlet." }, { status: 500 });
  }
}

/** Saves one change to an outlet: identification, GPS tag, rep validation, duplicate call, disowning, a draft or the final save of the whole form, or (admin / supervisor) reopening locked fields. */
export async function POST(req: NextRequest) {
  const who = await actorOr403();
  if ("denied" in who) return who.denied;
  const { actor } = who;
  if (actor.role === "HOD" || actor.role === "DIRECTOR") return NextResponse.json({ error: "HOD and Director accounts can view the cleanup but not change it." }, { status: 403 });
  const input = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const source = asSource(input?.source);
  const key = asKey(input?.outletKey);
  if (!input || !source || !key) return NextResponse.json({ error: "That request could not be read." }, { status: 400 });
  try {
    let result: object = { ok: true };
    switch (input.action) {
      case "save": {
        const set = asSet(input.set);
        const confirm = input.confirm === "ALL" ? "ALL" : Array.isArray(input.confirm) ? input.confirm.filter((f): f is IdentificationField => (IDENTIFICATION_FIELDS as readonly string[]).includes(f)) : undefined;
        await saveIdentification(actor, source, key, { set, confirm });
        break;
      }
      case "geo": {
        const geo = await tagGeo(actor, source, key, { latitude: asNumber(input.latitude), longitude: asNumber(input.longitude), accuracyM: asNumber(input.accuracyM) });
        result = { ok: true, distanceM: geo.distanceM, farFromPrevious: geo.farFromPrevious };
        break;
      }
      case "reps": {
        await decideReps(actor, source, key, asReps(input.reps));
        break;
      }
      case "draft": {
        result = { ok: true, ...(await saveDraft(actor, source, key, { set: input.set, reps: input.reps })) };
        break;
      }
      case "discardDraft": {
        await discardDraft(actor, source, key);
        break;
      }
      case "final": {
        await saveFinal(actor, source, key, { set: asSet(input.set), reps: asReps(input.reps) });
        break;
      }
      case "duplicate": {
        const otherSource = asSource(input.otherSource);
        const otherKey = asKey(input.otherKey);
        if (!otherSource || !otherKey || (input.decision !== "MERGE" && input.decision !== "NOT_DUPLICATE")) return NextResponse.json({ error: "That request could not be read." }, { status: 400 });
        await decideDuplicate(actor, source, key, { otherSource, otherKey, decision: input.decision, note: asText(input.note, 300) });
        break;
      }
      case "disown": {
        const candidates = Array.isArray(input.candidates) ? input.candidates.slice(0, 30).map((c) => asText(c, 120)) : [];
        await disownOutlet(actor, source, key, { reason: asText(input.reason, 300), candidates });
        break;
      }
      case "unlock": {
        const fields = Array.isArray(input.fields) ? input.fields.filter((f): f is LockableField => LOCKABLE.includes(f)) : [];
        if (fields.length === 0) return NextResponse.json({ error: "Choose a field to reopen." }, { status: 400 });
        await unlockFields(actor, source, key, fields);
        break;
      }
      default:
        return NextResponse.json({ error: "That request could not be read." }, { status: 400 });
    }
    const detail = await loadOutletDetail(actor, source, key);
    return NextResponse.json({ ...result, detail }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof CleanupError) {
      // After a partly saved "final", the form reloads what is now saved.
      const detail = error.partial ? await loadOutletDetail(actor, source, key).catch(() => null) : null;
      return NextResponse.json({ error: error.message, fields: error.fields ?? [], detail }, { status: error.status });
    }
    console.error("Failed to save the outlet cleanup", error);
    return NextResponse.json({ error: "Failed to save." }, { status: 500 });
  }
}
