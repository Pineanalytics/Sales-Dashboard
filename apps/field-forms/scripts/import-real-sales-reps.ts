/**
 * One-off import of Sales Rep roster rows into coaching_sales_reps.
 * Run AFTER import-real-roster.ts has created the real Team Leader/Supervisor
 * accounts. Sales Reps never get a login/auth account — they're a lightweight
 * roster entry matched to their Team Leader via manager_email.
 *
 * Run with: npx tsx scripts/import-real-sales-reps.ts <path-to-roster.csv>
 */
import { createClient } from "@supabase/supabase-js";
import Papa from "papaparse";
import fs from "fs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const COACHING_FORM_ID = "de8bc27c-c074-4220-a34c-6b07db02a61e";

const csvPath = process.argv[2];
if (!csvPath) {
  console.error("Usage: npx tsx scripts/import-real-sales-reps.ts <path-to-roster.csv>");
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
    data: {
      email?: string;
      full_name?: string;
      field_role: string;
      manager_email?: string;
      employee_code?: string;
    }[];
  };

  const repRows = rows.filter((r) => r.field_role === "sales_rep");

  const { data: profiles } = await admin
    .from("profiles")
    .select("id, email")
    .eq("assigned_form_id", COACHING_FORM_ID);
  const byEmail = new Map((profiles ?? []).map((p) => [p.email.toLowerCase(), p.id]));

  const { data: existingReps } = await admin
    .from("coaching_sales_reps")
    .select("full_name, team_leader_id")
    .eq("form_id", COACHING_FORM_ID);
  const existingKeys = new Set(
    (existingReps ?? []).map((r) => `${r.full_name.trim().toLowerCase()}|${r.team_leader_id}`)
  );

  const noTeamLeader: string[] = [];
  const createErrors: string[] = [];
  let created = 0;
  let skippedDup = 0;

  for (const row of repRows) {
    const fullName = row.full_name?.trim();
    if (!fullName) continue;
    const managerEmail = normalizeEmail(row.manager_email);
    const teamLeaderId = managerEmail ? byEmail.get(managerEmail) : undefined;
    if (!teamLeaderId) {
      noTeamLeader.push(`${fullName} (manager_email: ${row.manager_email ?? "blank"})`);
      continue;
    }
    const key = `${fullName.toLowerCase()}|${teamLeaderId}`;
    if (existingKeys.has(key)) {
      skippedDup++;
      continue;
    }
    const email = normalizeEmail(row.email);
    const { error } = await admin.from("coaching_sales_reps").insert({
      form_id: COACHING_FORM_ID,
      full_name: fullName,
      email,
      employee_code: row.employee_code || null,
      team_leader_id: teamLeaderId,
    });
    if (error) {
      createErrors.push(`${fullName}: ${error.message}`);
      continue;
    }
    existingKeys.add(key);
    created++;
    console.log(`Added rep: ${fullName} -> team leader ${teamLeaderId}`);
  }

  console.log("\n=== Summary ===");
  console.log("Sales rep rows in CSV:", repRows.length);
  console.log("Created:", created);
  console.log("Already existed (skipped):", skippedDup);
  console.log("No team leader resolved:", noTeamLeader.length);
  if (noTeamLeader.length) console.log(noTeamLeader);
  console.log("Errors:", createErrors);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
