import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

const MAX_RECORDS = 2_000;

type BridgeRequest = {
  formId?: unknown;
  from?: unknown;
  to?: unknown;
  principal?: unknown;
  allLeaders?: unknown;
  leaderNames?: unknown;
  operation?: unknown;
  accompanimentId?: unknown;
  status?: unknown;
  comments?: unknown;
};

function validBridgeKey(request: Request) {
  const expected = process.env.COACHING_REFERENCE_SYNC_KEY;
  const received = request.headers.get("x-coaching-reference-key");
  if (!expected || !received) return false;
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
}

function isoDate(value: unknown, fallback: string) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
}

function namesFrom(value: unknown) {
  return Array.isArray(value)
    ? Array.from(new Set(value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())))
    : [];
}

async function leaderIdsForScope(formId: string, allLeaders: boolean, leaderNames: string[]) {
  const admin = createAdminClient();
  let query = admin
    .from("profiles")
    .select("id, full_name")
    .eq("assigned_form_id", formId)
    .in("field_role", ["team_leader", "key_account_rep"]);
  if (!allLeaders) {
    if (leaderNames.length === 0) return { admin, leaderIds: [] as string[], leaderNamesById: new Map<string, string>() };
    query = query.in("full_name", leaderNames);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return {
    admin,
    leaderIds: (data ?? []).map((profile) => profile.id),
    leaderNamesById: new Map((data ?? []).map((profile) => [profile.id, profile.full_name ?? "Unassigned"])),
  };
}

async function canAccessAccompaniment(formId: string, accompanimentId: string, allLeaders: boolean, leaderNames: string[]) {
  const { admin, leaderIds } = await leaderIdsForScope(formId, allLeaders, leaderNames);
  if (leaderIds.length === 0) return { admin, allowed: false };
  const { data, error } = await admin
    .from("coaching_accompaniments")
    .select("id")
    .eq("id", accompanimentId)
    .eq("form_id", formId)
    .in("team_leader_id", leaderIds)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return { admin, allowed: Boolean(data) };
}

/**
 * Private Analytics bridge. It deliberately uses the shared server key rather
 * than browser authentication: Analytics authenticates the human and derives
 * their reporting scope; this route enforces only that signed server request.
 * No existing Coaching page, session or RLS policy is changed.
 */
export async function POST(request: Request) {
  if (!validBridgeKey(request)) return NextResponse.json({ error: "Invalid Analytics bridge credentials." }, { status: 401 });

  let body: BridgeRequest;
  try {
    body = (await request.json()) as BridgeRequest;
  } catch {
    return NextResponse.json({ error: "Expected a JSON request body." }, { status: 400 });
  }
  const formId = typeof body.formId === "string" ? body.formId : "";
  if (!formId) return NextResponse.json({ error: "A form ID is required." }, { status: 400 });
  const allLeaders = body.allLeaders === true;
  const leaderNames = namesFrom(body.leaderNames);

  if (body.operation === "review") {
    if (typeof body.accompanimentId !== "string" || !["supervisor_reviewed", "approved"].includes(String(body.status))) {
      return NextResponse.json({ error: "A valid accompaniment and decision are required." }, { status: 400 });
    }
    const { admin, allowed } = await canAccessAccompaniment(formId, body.accompanimentId, allLeaders, leaderNames);
    if (!allowed) return NextResponse.json({ error: "That accompaniment is outside the permitted Coaching scope." }, { status: 403 });
    const comments = typeof body.comments === "string" ? body.comments.trim().slice(0, 4_000) : "";
    const { data, error } = await admin
      .from("coaching_accompaniments")
      .update({ status: body.status, supervisor_comments: comments || null })
      .eq("id", body.accompanimentId)
      .select("id, status, supervisor_comments")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, accompaniment: data });
  }

  const today = new Date().toISOString().slice(0, 10);
  const startOfMonth = `${today.slice(0, 8)}01`;
  const from = isoDate(body.from, startOfMonth);
  const to = isoDate(body.to, today);
  const principal = typeof body.principal === "string" ? body.principal.trim() : "";

  try {
    const { admin, leaderIds, leaderNamesById } = await leaderIdsForScope(formId, allLeaders, leaderNames);
    if (leaderIds.length === 0) {
      return NextResponse.json({ generatedAt: new Date().toISOString(), principals: [], accompaniments: [], visits: [], actions: [] });
    }
    const { data: rawAccompaniments, error: accompanimentError } = await admin
      .from("coaching_accompaniments")
      .select("id, team_leader_id, sales_rep_id, date, status, overall_score, supervisor_comments")
      .eq("form_id", formId)
      .in("team_leader_id", leaderIds)
      .gte("date", from)
      .lte("date", to)
      .order("date", { ascending: false })
      .limit(MAX_RECORDS);
    if (accompanimentError) throw new Error(accompanimentError.message);

    const accompanimentIds = (rawAccompaniments ?? []).map((item) => item.id);
    const [{ data: rawVisits }, { data: principals }, { data: reps }] = await Promise.all([
      accompanimentIds.length
        ? admin.from("coaching_outlet_visits").select("id, accompaniment_id, outlet_id, planned, geofence_status").in("accompaniment_id", accompanimentIds)
        : Promise.resolve({ data: [] }),
      admin.from("coaching_principals").select("id, name").eq("form_id", formId).eq("is_active", true).order("name"),
      admin.from("coaching_sales_reps").select("id, full_name").eq("form_id", formId),
    ]);
    const outletIds = Array.from(new Set((rawVisits ?? []).map((visit) => visit.outlet_id)));
    const { data: outlets } = outletIds.length
      ? await admin.from("coaching_outlets").select("id, name, principal_id").in("id", outletIds)
      : { data: [] };
    const outletById = new Map((outlets ?? []).map((outlet) => [outlet.id, outlet]));
    const includedIds = new Set(
      !principal
        ? accompanimentIds
        : (rawVisits ?? []).filter((visit) => outletById.get(visit.outlet_id)?.principal_id === principal).map((visit) => visit.accompaniment_id)
    );
    const accompaniments = (rawAccompaniments ?? []).filter((item) => includedIds.has(item.id));
    const includedAccompanimentIds = accompaniments.map((item) => item.id);
    const { data: actions } = includedAccompanimentIds.length
      ? await admin
          .from("coaching_action_plans")
          .select("id, accompaniment_id, issue, coaching_area, priority, target_date, status")
          .in("accompaniment_id", includedAccompanimentIds)
          .order("target_date", { ascending: true, nullsFirst: false })
          .limit(MAX_RECORDS)
      : { data: [] };
    const repNamesById = new Map((reps ?? []).map((rep) => [rep.id, rep.full_name]));
    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      principals: principals ?? [],
      accompaniments: accompaniments.map((item) => ({
        ...item,
        teamLeaderName: leaderNamesById.get(item.team_leader_id) ?? "Unassigned",
        salesRepName: repNamesById.get(item.sales_rep_id) ?? "Unassigned",
      })),
      visits: (rawVisits ?? []).filter((visit) => includedIds.has(visit.accompaniment_id)).map((visit) => ({
        ...visit,
        outletName: outletById.get(visit.outlet_id)?.name ?? "Unassigned outlet",
      })),
      actions: actions ?? [],
    });
  } catch (error) {
    console.error("Analytics Coaching bridge failed", error);
    return NextResponse.json({ error: "Could not load Coaching records." }, { status: 502 });
  }
}
