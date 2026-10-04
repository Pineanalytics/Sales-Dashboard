import { PHONE_SW } from "@/lib/phoneRelayPage";

export const runtime = "nodejs";

export async function GET() {
  return new Response(PHONE_SW, {
    headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache", "Service-Worker-Allowed": "/phone" },
  });
}
