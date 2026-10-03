import { NextRequest, NextResponse } from "next/server";
import { getPhoneView } from "@/lib/phoneRelay";
import { authorise, noStore } from "@/lib/phoneRelayAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Phone: current status of both PC agents, the PC's public key, and recent command results. */
export async function GET(request: NextRequest) {
  const denied = authorise(request, "phone");
  if (denied) return denied;
  return NextResponse.json(getPhoneView(Date.now()), { headers: noStore });
}
