/**
 * One-off real-roster import for the coaching tenant. Mirrors the logic in
 * app/api/admin/coaching-roster/route.ts exactly (create-if-missing via
 * Admin API with a shared temp password, resolve manager_id, skip rows with
 * no usable email / self-referential manager) but run directly against the
 * Admin API instead of through the HTTP route, since this is a one-time
 * bulk load rather than an admin-UI upload.
 *
 * Run with: npx tsx scripts/import-real-roster.ts <path-to-roster.csv>
 */
import { createClient } from "@supabase/supabase-js";
import Papa from "papaparse";
import fs from "fs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const COACHING_FORM_ID = "de8bc27c-c074-4220-a34c-6b07db02a61e";
const TEMP_PASSWORD = "Pineapps2026!";
const FIELD_ROLES = ["team_leader", "sales_rep", "supervisor"];

const csvPath = process.argv[2];
if (!csvPath) {
  console.error("Usage: npx tsx scripts/import-real-roster.ts <path-to-roster.csv>");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function normalizeEmail(raw: string | undefined | null): string | null {
  const email = raw?.trim().toLowerCase();
  if (!email || email === "n/a" || email === "na" || !email.includes("@")) return null;
  return email;
}

async function main() {
  const content = fs.readFileSync(csvPath, "utf8");
  const { data: rows } = Papa.parse(content, { header: true, skipEmptyLines: true }) as {
    data: { email: string; full_name?: string; field_role: string; manager_email?: string }[];
  };

  const { data: existing } = await admin.from("profiles").select("id, email");
  const byEmail = new Map((existing ?? []).map((p) => [p.email.toLowerCase(), p.id]));

  const notFound: string[] = [];
  const invalidRole: string[] = [];
  const createErrors: string[] = [];
  const skippedNoEmail: string[] = [];
  let created = 0;
  let updated = 0;

  for (const row of rows) {
    const email = normalizeEmail(row.email);
    if (!email) {
      if (row.full_name) skippedNoEmail.push(row.full_name);
      continue;
    }
    if (byEmail.has(email)) continue;
    if (!FIELD_ROLES.includes(row.field_role)) {
      invalidRole.push(row.email);
      continue;
    }
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: TEMP_PASSWORD,
      email_confirm: true,
      user_metadata: row.full_name ? { full_name: row.full_name } : undefined,
    });
    if (error || !data.user) {
      createErrors.push(`${row.email}: ${error?.message ?? "unknown error"}`);
      continue;
    }
    byEmail.set(email, data.user.id);
    created++;
    console.log(`Created: ${email}`);
  }

  for (const row of rows) {
    const email = normalizeEmail(row.email);
    if (!email) continue;
    if (!FIELD_ROLES.includes(row.field_role)) continue;
    const id = byEmail.get(email);
    if (!id) {
      notFound.push(row.email);
      continue;
    }
    const update: Record<string, unknown> = {
      field_role: row.field_role,
      assigned_form_id: COACHING_FORM_ID,
      status: "approved",
    };
    if (row.full_name) update.full_name = row.full_name;
    await admin.from("profiles").update(update).eq("id", id);
    updated++;
  }

  for (const row of rows) {
    const email = normalizeEmail(row.email);
    const managerEmail = normalizeEmail(row.manager_email);
    if (!email || !managerEmail || email === managerEmail) continue;
    const id = byEmail.get(email);
    const managerId = byEmail.get(managerEmail);
    if (id && managerId) {
      await admin.from("profiles").update({ manager_id: managerId }).eq("id", id);
    }
  }

  console.log("\n=== Summary ===");
  console.log("Created:", created);
  console.log("Updated:", updated);
  console.log("Skipped (no email):", skippedNoEmail.length);
  console.log("Not found:", notFound);
  console.log("Invalid role:", invalidRole);
  console.log("Create errors:", createErrors);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
