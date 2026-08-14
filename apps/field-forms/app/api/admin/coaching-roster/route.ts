import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { FIELD_ROLES } from "@/lib/coachingTypes";

interface RosterRow {
  email: string;
  full_name?: string;
  field_role: string;
  manager_email?: string;
  employee_code?: string;
}

// Real-world roster exports commonly use "N/A" (or blank) as a placeholder
// for people who don't have a company email yet — treat those as absent
// rather than trying to create an account for the literal string "n/a".
function normalizeEmail(raw: string | undefined | null): string | null {
  const email = raw?.trim().toLowerCase();
  if (!email || email === "n/a" || email === "na" || !email.includes("@")) return null;
  return email;
}

// Bulk-onboards Team Leaders/Sales Reps/Supervisors by roster upload (email +
// role + manager's email). Anyone whose email doesn't already have an
// account is created outright via the Admin API with the supplied shared
// temporary password (the admin distributes this to the team directly) —
// this is a deliberate choice for a real-roster rollout, unlike the
// merchandiser_codes "wait for self-signup" pattern used elsewhere.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, assigned_form_id")
    .eq("id", user.id)
    .single();

  const { formId, rows, tempPassword } = (await request.json()) as {
    formId: string;
    rows: RosterRow[];
    tempPassword: string;
  };
  if (typeof formId !== "string" || !Array.isArray(rows)) {
    return NextResponse.json({ error: "Missing formId or rows" }, { status: 400 });
  }
  const canManage = profile?.role === "super_admin" || (profile?.role === "admin" && profile.assigned_form_id === formId);
  if (!canManage) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (typeof tempPassword !== "string" || tempPassword.length < 6) {
    return NextResponse.json({ error: "Temporary password must be at least 6 characters." }, { status: 400 });
  }

  const admin = createAdminClient();

  // Look up existing accounts across ALL profiles (not just this tenant) —
  // someone might already have an account from a different form.
  const { data: existing } = await admin.from("profiles").select("id, email");
  const byEmail = new Map((existing ?? []).map((p) => [p.email.toLowerCase(), p.id]));

  const notFound: string[] = [];
  const invalidRole: string[] = [];
  const createErrors: string[] = [];
  let created = 0;
  let updated = 0;

  const skippedNoEmail: string[] = [];

  // Sales Reps never get a login/auth account — they're a lightweight roster
  // their Team Leader manages (see coaching_sales_reps). Only Team Leaders,
  // Supervisors, and Admins go through the account-creation passes below.
  const accountRows = rows.filter((r) => r.field_role !== "sales_rep");
  const repRows = rows.filter((r) => r.field_role === "sales_rep");

  // First pass: create any account that doesn't exist yet.
  for (const row of accountRows) {
    const email = normalizeEmail(row.email);
    if (!email) {
      if (row.full_name) skippedNoEmail.push(row.full_name);
      continue;
    }
    if (byEmail.has(email)) continue;
    if (!FIELD_ROLES.includes(row.field_role as (typeof FIELD_ROLES)[number])) {
      invalidRole.push(row.email);
      continue;
    }
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: row.full_name ? { full_name: row.full_name } : undefined,
    });
    if (error || !data.user) {
      createErrors.push(`${row.email}: ${error?.message ?? "unknown error"}`);
      continue;
    }
    byEmail.set(email, data.user.id);
    created++;
  }

  // Second pass: apply role/assigned_form_id/full_name for every row now
  // that its account (existing or freshly created) definitely resolves.
  for (const row of accountRows) {
    const email = normalizeEmail(row.email);
    if (!email) continue;
    if (!FIELD_ROLES.includes(row.field_role as (typeof FIELD_ROLES)[number])) continue;
    const id = byEmail.get(email);
    if (!id) {
      notFound.push(row.email);
      continue;
    }
    const update: Record<string, unknown> = {
      field_role: row.field_role,
      assigned_form_id: formId,
      status: "approved",
    };
    if (row.full_name) update.full_name = row.full_name;
    await admin.from("profiles").update(update).eq("id", id);
    updated++;
  }

  // Third pass: resolve manager_id now that every row's own id is known.
  // A row listing itself as its own manager (common in exports for whoever
  // sits at the top of the chain) means "no manager" — never create a
  // self-referential loop.
  for (const row of accountRows) {
    const email = normalizeEmail(row.email);
    const managerEmail = normalizeEmail(row.manager_email);
    if (!email || !managerEmail || email === managerEmail) continue;
    const id = byEmail.get(email);
    const managerId = byEmail.get(managerEmail);
    if (id && managerId) {
      await admin.from("profiles").update({ manager_id: managerId }).eq("id", id);
    }
  }

  // Key Account Reps get a real login (handled by the passes above like any
  // other account role) but still need a coaching_sales_reps row so they can
  // own accompaniment/outlet-visit/action-plan records the same way a
  // Team-Leader-coached Sales Rep does. The row's id is set to their OWN
  // profile id (not a random uuid) — every existing RLS policy that checks
  // `sales_rep_id = auth.uid()` then grants them access to their own
  // records with zero policy changes.
  for (const row of accountRows) {
    if (row.field_role !== "key_account_rep") continue;
    const email = normalizeEmail(row.email);
    if (!email) continue;
    const id = byEmail.get(email);
    if (!id) continue;
    await admin
      .from("coaching_sales_reps")
      .upsert(
        { id, form_id: formId, full_name: row.full_name || email, team_leader_id: id },
        { onConflict: "id" }
      );
  }

  // Fourth pass: Sales Reps get inserted straight into coaching_sales_reps,
  // matched to their Team Leader via manager_email resolved against the
  // profiles created/updated above. No auth account, ever.
  const repsNoTeamLeader: string[] = [];
  let repsCreated = 0;
  const { data: existingReps } = await admin
    .from("coaching_sales_reps")
    .select("full_name, team_leader_id")
    .eq("form_id", formId);
  const existingRepKeys = new Set(
    (existingReps ?? []).map((r) => `${r.full_name.trim().toLowerCase()}|${r.team_leader_id}`)
  );
  for (const row of repRows) {
    const fullName = row.full_name?.trim();
    if (!fullName) continue;
    const managerEmail = normalizeEmail(row.manager_email);
    const teamLeaderId = managerEmail ? byEmail.get(managerEmail) : undefined;
    if (!teamLeaderId) {
      repsNoTeamLeader.push(fullName);
      continue;
    }
    const key = `${fullName.toLowerCase()}|${teamLeaderId}`;
    if (existingRepKeys.has(key)) continue;
    const email = normalizeEmail(row.email);
    const { error } = await admin.from("coaching_sales_reps").insert({
      form_id: formId,
      full_name: fullName,
      email,
      employee_code: row.employee_code || null,
      team_leader_id: teamLeaderId,
    });
    if (!error) {
      existingRepKeys.add(key);
      repsCreated++;
    } else {
      createErrors.push(`${fullName}: ${error.message}`);
    }
  }

  return NextResponse.json({
    ok: true,
    created,
    updated,
    notFound,
    invalidRole,
    createErrors,
    skippedNoEmail,
    repsCreated,
    repsNoTeamLeader,
  });
}
