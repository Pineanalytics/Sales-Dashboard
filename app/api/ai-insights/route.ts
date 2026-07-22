import { NextResponse } from "next/server";
import { getLatestAiInsight } from "@/lib/aiInsights";
import { auth } from "@/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  try {
    const insight = await getLatestAiInsight();
    return NextResponse.json({ insight });
  } catch (err) {
    console.error("Failed to load AI insight", err);
    return NextResponse.json({ error: "Failed to load AI insight." }, { status: 500 });
  }
}
