import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type AnalyticsPrincipal = { principal: string; mainPrincipal: string; location: string; locationCode: string | null };
type AnalyticsEmployee = { employeeCode: string; pineName: string; sapName: string };
type AnalyticsAssignment = { teamLeaderId: string; employeeCode: string; employeeName: string; principal: string };
type AnalyticsTeamLeader = { id: string; name: string };
type ReferenceSnapshot = {
  principals: AnalyticsPrincipal[];
  employees: AnalyticsEmployee[];
  assignments: AnalyticsAssignment[];
  teamLeaders: AnalyticsTeamLeader[];
};

function normalized(value: string | null | undefined) {
  return value?.trim().toLocaleLowerCase() ?? "";
}

/**
 * Refreshes only the shared operational roster. The Coaching database remains
 * the owner of app accounts, roles, passwords, visit evidence and geofence
 * settings. An employee with a matrix reporting line is deliberately skipped:
 * coaching_sales_reps supports one leader per rep, and silently choosing one
 * would corrupt Pinefrost Analytics' ownership relationship.
 */
export async function POST(request: Request) {
  const sessionClient = await createClient();
  const { data: { user } } = await sessionClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { formId } = (await request.json()) as { formId?: unknown };
  if (typeof formId !== "string" || !formId) {
    return NextResponse.json({ error: "A form ID is required." }, { status: 400 });
  }
  const { data: viewer } = await sessionClient
    .from("profiles")
    .select("role, assigned_form_id")
    .eq("id", user.id)
    .single();
  const canManage = viewer?.role === "super_admin" || (viewer?.role === "admin" && viewer.assigned_form_id === formId);
  if (!canManage) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const baseUrl = process.env.ANALYTICS_REFERENCE_URL?.replace(/\/$/, "");
  const bridgeKey = process.env.COACHING_REFERENCE_SYNC_KEY;
  if (!baseUrl || !bridgeKey) {
    return NextResponse.json({ error: "The Pinefrost Analytics reference connection has not been configured yet." }, { status: 503 });
  }

  let snapshot: ReferenceSnapshot;
  try {
    const response = await fetch(`${baseUrl}/api/integrations/coaching/reference?resource=roster`, {
      headers: { "x-coaching-reference-key": bridgeKey },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Analytics returned ${response.status}`);
    snapshot = (await response.json()) as ReferenceSnapshot;
  } catch (error) {
    console.error("Coaching roster reference sync failed", error);
    return NextResponse.json({ error: "Could not reach Pinefrost Analytics for the roster refresh." }, { status: 502 });
  }

  const admin = createAdminClient();
  const [{ data: existingPrincipals }, { data: profiles }, { data: existingReps }] = await Promise.all([
    admin.from("coaching_principals").select("id, name").eq("form_id", formId),
    admin.from("profiles").select("id, full_name, field_role").eq("assigned_form_id", formId),
    admin.from("coaching_sales_reps").select("id, employee_code").eq("form_id", formId),
  ]);

  const principalNames = new Set((existingPrincipals ?? []).map((row) => normalized(row.name)));
  const missingPrincipals = snapshot.principals
    .map((row) => row.principal.trim())
    .filter((name) => name && !principalNames.has(normalized(name)));
  if (missingPrincipals.length) {
    const { error } = await admin.from("coaching_principals").insert(missingPrincipals.map((name) => ({ form_id: formId, name })));
    if (error) return NextResponse.json({ error: `Could not add principals: ${error.message}` }, { status: 500 });
  }

  const leaderProfileByName = new Map<string, string>();
  for (const profile of profiles ?? []) {
    if (profile.field_role !== "team_leader" && profile.field_role !== "key_account_rep") continue;
    const name = normalized(profile.full_name);
    if (name) leaderProfileByName.set(name, profile.id);
  }
  const leaderNameById = new Map(snapshot.teamLeaders.map((leader) => [leader.id, leader.name]));
  const employeeByCode = new Map(snapshot.employees.map((employee) => [employee.employeeCode, employee]));
  const assignedLeaders = new Map<string, Set<string>>();
  for (const assignment of snapshot.assignments) {
    const leaderProfileId = leaderProfileByName.get(normalized(leaderNameById.get(assignment.teamLeaderId)));
    if (!leaderProfileId) continue;
    const leaders = assignedLeaders.get(assignment.employeeCode) ?? new Set<string>();
    leaders.add(leaderProfileId);
    assignedLeaders.set(assignment.employeeCode, leaders);
  }

  const existingRepByCode = new Map(
    (existingReps ?? []).filter((rep) => rep.employee_code).map((rep) => [rep.employee_code!, rep.id])
  );
  let repsCreated = 0;
  let repsUpdated = 0;
  const matrixReps: string[] = [];
  const unlinkedLeaders = new Set<string>();
  for (const [employeeCode, leaderIds] of assignedLeaders) {
    const employee = employeeByCode.get(employeeCode);
    if (!employee) continue;
    if (leaderIds.size !== 1) {
      matrixReps.push(employeeCode);
      continue;
    }
    const teamLeaderId = [...leaderIds][0];
    const existingId = existingRepByCode.get(employeeCode);
    const values = { full_name: employee.pineName, employee_code: employeeCode, team_leader_id: teamLeaderId, is_active: true };
    const { error } = existingId
      ? await admin.from("coaching_sales_reps").update(values).eq("id", existingId)
      : await admin.from("coaching_sales_reps").insert({ form_id: formId, ...values });
    if (error) return NextResponse.json({ error: `Could not update ${employee.pineName}: ${error.message}` }, { status: 500 });
    if (existingId) repsUpdated++;
    else repsCreated++;
  }
  for (const assignment of snapshot.assignments) {
    const leaderName = leaderNameById.get(assignment.teamLeaderId);
    if (leaderName && !leaderProfileByName.has(normalized(leaderName))) unlinkedLeaders.add(leaderName);
  }

  return NextResponse.json({
    ok: true,
    principalsCreated: missingPrincipals.length,
    repsCreated,
    repsUpdated,
    matrixReps: matrixReps.slice(0, 50),
    matrixRepCount: matrixReps.length,
    unlinkedLeaders: [...unlinkedLeaders].sort().slice(0, 50),
    unlinkedLeaderCount: unlinkedLeaders.size,
  });
}
