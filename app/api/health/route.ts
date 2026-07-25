import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// Unauthenticated on purpose — this is what the VPS migration's uptime monitor
// (Step 6 of the Hostinger migration plan) polls from outside the box. Confirms
// both the Node process and its DB connection are alive, not just that Caddy
// is answering.
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok" });
  } catch (error) {
    return NextResponse.json({ status: "error", message: (error as Error).message }, { status: 503 });
  }
}
