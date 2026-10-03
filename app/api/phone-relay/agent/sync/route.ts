import { NextRequest, NextResponse } from "next/server";
import { syncAgent, type RelayTarget } from "@/lib/phoneRelay";
import { authorise, noStore } from "@/lib/phoneRelayAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PC agent: report status + results of finished commands, and collect new commands, in one call. */
export async function POST(request: NextRequest) {
  const denied = authorise(request, "agent");
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) ?? {};
  const target = body.agent as RelayTarget;
  if (target !== "automation" && target !== "panel") return NextResponse.json({ error: "Unknown agent." }, { status: 400, headers: noStore });
  const result = syncAgent(target, body, Date.now());
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status, headers: noStore });
  return NextResponse.json({ commands: result.commands }, { headers: noStore });
}
