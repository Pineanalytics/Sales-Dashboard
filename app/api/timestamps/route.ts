import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  try {
    const calls = await prisma.repCall.findMany({ orderBy: [{ date: "asc" }, { employeeCode: "asc" }, { callSequence: "asc" }] });
    return NextResponse.json({ calls });
  } catch (err) {
    console.error("Failed to load Timestamps data", err);
    return NextResponse.json({ error: "Failed to load Timestamps data." }, { status: 500 });
  }
}
