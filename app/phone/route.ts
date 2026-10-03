import { PHONE_PAGE } from "@/lib/phoneRelayPage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public by design (no session): the page holds no data, and every API it calls
// demands the phone key that the one-time setup link installs on the phone.
export async function GET() {
  return new Response(PHONE_PAGE, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
    },
  });
}
