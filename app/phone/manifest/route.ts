import { PHONE_MANIFEST } from "@/lib/phoneRelayPage";

export const runtime = "nodejs";

export async function GET() {
  return new Response(JSON.stringify(PHONE_MANIFEST), { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "public, max-age=3600" } });
}
