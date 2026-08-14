import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Retired after the controlled full-estate reconciler was introduced.
 * Keeping this explicit response prevents the previous page-at-a-time writer
 * from creating source-coded duplicates against the legacy outlet estate.
 */
export async function POST() {
  const sessionClient = await createClient();
  const { data: { user } } = await sessionClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(
    { error: "Use the controlled background outlet refresh. It reconciles the full estate before writing any rows." },
    { status: 410 }
  );
}
