import { NextRequest, NextResponse } from "next/server";
import { clientAddress, enqueueCommand } from "@/lib/phoneRelay";
import { authorise, noStore } from "@/lib/phoneRelayAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Phone: queue a command (login/mfa carry RSA-encrypted payloads; this route never sees plaintext). */
export async function POST(request: NextRequest) {
  const denied = authorise(request, "phone");
  if (denied) return denied;
  const body = await request.json().catch(() => ({}));
  const result = enqueueCommand(body ?? {}, clientAddress(request.headers), Date.now());
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status, headers: noStore });
  return NextResponse.json({ id: result.id }, { headers: noStore });
}
