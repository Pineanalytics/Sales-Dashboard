import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getLeverageMonthlyCoverageRollup } from "@/lib/jpAdherence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Unilever/Leverage's monthly outlet coverage for the Coverage & Productivity
 * page's own dedicated section — kept out of the shared dataset/monthlyCoverage
 * pipeline on purpose (see getLeverageMonthlyCoverageRollup's doc comment for
 * why: no strike rate is possible from this source, unlike Pine/EABL/Upfield). */
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  try {
    const rows = await getLeverageMonthlyCoverageRollup();
    return NextResponse.json({ rows });
  } catch (error) {
    console.error("Failed to load Leverage monthly coverage", error);
    return NextResponse.json({ error: "Failed to load Leverage coverage." }, { status: 500 });
  }
}
