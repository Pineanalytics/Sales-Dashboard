/**
 * One-off migration: recreate the 27 real auth.users accounts from Supabase
 * Cloud onto the new self-hosted GoTrue instance, preserving the exact same
 * UUIDs (public.profiles.id foreign-keys to these, and profiles data was
 * already migrated with the original IDs intact).
 *
 * We never touch or copy password hashes (not exposed via any API, and
 * fetching auth.users directly is blocked as credential-sensitive) — instead
 * every account is recreated with the shared temp password already in use
 * for real accounts this rollout (Pineapps2026!). Users change it themselves
 * after first login, same as the original real-roster onboarding.
 *
 * Run with: npx tsx scripts/migrate-auth-users.ts
 */
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

const SELF_HOSTED_URL = "https://app.pinefrostdb.com";
const SELF_HOSTED_SERVICE_KEY = process.env.SELF_HOSTED_SERVICE_KEY!;
const TEMP_PASSWORD = "Pineapps2026!";

const usersPath = process.argv[2] || path.join(__dirname, "..", "..", "..", "users.json");

const admin = createClient(SELF_HOSTED_URL, SELF_HOSTED_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const users = JSON.parse(fs.readFileSync(usersPath, "utf8")) as {
    id: string;
    email: string;
    full_name: string;
  }[];

  let created = 0;
  const errors: string[] = [];

  for (const u of users) {
    const { data, error } = await admin.auth.admin.createUser({
      id: u.id,
      email: u.email,
      password: TEMP_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: u.full_name },
    });
    if (error) {
      errors.push(`${u.email}: ${error.message}`);
      continue;
    }
    if (data.user?.id !== u.id) {
      errors.push(`${u.email}: created but with mismatched id (got ${data.user?.id}, expected ${u.id})`);
      continue;
    }
    created++;
    console.log(`Created: ${u.email} (${u.id})`);
  }

  console.log("\n=== Summary ===");
  console.log("Created:", created, "/", users.length);
  console.log("Errors:", errors);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
