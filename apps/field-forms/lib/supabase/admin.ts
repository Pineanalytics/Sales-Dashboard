import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Service-role client for privileged operations (e.g. directly setting a
// user's password as a super admin). Server-only — never import this from
// a "use client" component or expose SUPABASE_SERVICE_ROLE_KEY to the browser.
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
