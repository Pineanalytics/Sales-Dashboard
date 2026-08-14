import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type OutletRow = {
  principal: string;
  customerId: string;
  outletName: string;
  channel: string;
  mostRecentRep: string | null;
};
type OutletResponse = { outlets: OutletRow[]; nextCursor: string | null };

function normalized(value: string | null | undefined) {
  return value?.trim().toLocaleLowerCase() ?? "";
}

function sourceCode(outlet: OutletRow) {
  return `PINE:${outlet.principal}:${outlet.customerId}`;
}

/** Syncs a bounded page so a large outlet estate never makes normal navigation slow. */
export async function POST(request: Request) {
  const sessionClient = await createClient();
  const { data: { user } } = await sessionClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { formId, cursor } = (await request.json()) as { formId?: unknown; cursor?: unknown };
  if (typeof formId !== "string" || (cursor !== undefined && typeof cursor !== "string")) {
    return NextResponse.json({ error: "Invalid outlet refresh request." }, { status: 400 });
  }
  const { data: viewer } = await sessionClient.from("profiles").select("role, assigned_form_id").eq("id", user.id).single();
  const canManage = viewer?.role === "super_admin" || (viewer?.role === "admin" && viewer.assigned_form_id === formId);
  if (!canManage) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const baseUrl = process.env.ANALYTICS_REFERENCE_URL?.replace(/\/$/, "");
  const bridgeKey = process.env.COACHING_REFERENCE_SYNC_KEY;
  if (!baseUrl || !bridgeKey) return NextResponse.json({ error: "The Pinefrost Analytics reference connection has not been configured yet." }, { status: 503 });

  const url = new URL(`${baseUrl}/api/integrations/coaching/reference`);
  url.searchParams.set("resource", "outlets");
  url.searchParams.set("pageSize", "250");
  if (typeof cursor === "string" && cursor) url.searchParams.set("cursor", cursor);
  let payload: OutletResponse;
  try {
    const response = await fetch(url, { headers: { "x-coaching-reference-key": bridgeKey }, cache: "no-store" });
    if (!response.ok) throw new Error(`Analytics returned ${response.status}`);
    payload = (await response.json()) as OutletResponse;
  } catch (error) {
    console.error("Coaching outlet reference sync failed", error);
    return NextResponse.json({ error: "Could not reach Pinefrost Analytics for the outlet refresh." }, { status: 502 });
  }

  const admin = createAdminClient();
  const [principalsResult, channelsResult, repsResult] = await Promise.all([
    admin.from("coaching_principals").select("id, name").eq("form_id", formId),
    admin.from("coaching_channels").select("id, name").eq("form_id", formId),
    admin.from("coaching_sales_reps").select("id, full_name, team_leader_id").eq("form_id", formId).eq("is_active", true),
  ]);
  const principalByName = new Map((principalsResult.data ?? []).map((row) => [normalized(row.name), row.id]));
  const channelByName = new Map((channelsResult.data ?? []).map((row) => [normalized(row.name), row.id]));
  const repByName = new Map((repsResult.data ?? []).map((row) => [normalized(row.full_name), row]));

  const missingPrincipalNames = [...new Set(payload.outlets.map((row) => row.principal.trim()).filter((name) => name && !principalByName.has(normalized(name))))];
  if (missingPrincipalNames.length) {
    const { data, error } = await admin.from("coaching_principals").insert(missingPrincipalNames.map((name) => ({ form_id: formId, name }))).select("id, name");
    if (error) return NextResponse.json({ error: `Could not create principals: ${error.message}` }, { status: 500 });
    for (const row of data ?? []) principalByName.set(normalized(row.name), row.id);
  }
  const missingChannelNames = [...new Set(payload.outlets.map((row) => row.channel.trim()).filter((name) => name && !channelByName.has(normalized(name))))];
  if (missingChannelNames.length) {
    const { data, error } = await admin.from("coaching_channels").insert(missingChannelNames.map((name) => ({ form_id: formId, name }))).select("id, name");
    if (error) return NextResponse.json({ error: `Could not create channels: ${error.message}` }, { status: 500 });
    for (const row of data ?? []) channelByName.set(normalized(row.name), row.id);
  }

  const codes = payload.outlets.map(sourceCode);
  const { data: existingOutlets } = codes.length
    ? await admin.from("coaching_outlets").select("id, outlet_code").eq("form_id", formId).in("outlet_code", codes)
    : { data: [] };
  const existingByCode = new Map((existingOutlets ?? []).map((row) => [row.outlet_code, row.id]));
  let created = 0;
  let updated = 0;
  let assignmentMatched = 0;
  for (const outlet of payload.outlets) {
    const rep = repByName.get(normalized(outlet.mostRecentRep));
    const values = {
      outlet_code: sourceCode(outlet),
      name: outlet.outletName.trim() || outlet.customerId,
      principal_id: principalByName.get(normalized(outlet.principal)) ?? null,
      channel_id: channelByName.get(normalized(outlet.channel)) ?? null,
      assigned_sales_rep_id: rep?.id ?? null,
      assigned_team_leader_id: rep?.team_leader_id ?? null,
      is_active: true,
    };
    if (rep) assignmentMatched++;
    const existingId = existingByCode.get(values.outlet_code);
    const { error } = existingId
      ? await admin.from("coaching_outlets").update(values).eq("id", existingId)
      : await admin.from("coaching_outlets").insert({ form_id: formId, geofence_radius_m: 100, ...values });
    if (error) return NextResponse.json({ error: `Could not sync ${values.name}: ${error.message}` }, { status: 500 });
    if (existingId) updated++;
    else created++;
  }

  return NextResponse.json({ ok: true, created, updated, assignmentMatched, processed: payload.outlets.length, nextCursor: payload.nextCursor });
}
