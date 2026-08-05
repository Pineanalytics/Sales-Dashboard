import { NextRequest, NextResponse } from "next/server";
import { getLatestSnapshot, getSnapshotById, filterDatasetToPrincipals } from "@/lib/datasetStore";
import { auth } from "@/auth";
import { resolveScopeForSession } from "@/lib/teamLeaderScope";
import { normalizePrincipalKey } from "@/lib/normalize";
import type { Dataset } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const id = req.nextUrl.searchParams.get("id");

  try {
    let dataset: Dataset | null;
    if (id) {
      dataset = await getSnapshotById(id);
      if (!dataset) {
        return NextResponse.json({ error: `No snapshot found with id "${id}".` }, { status: 404 });
      }
    } else {
      dataset = await getLatestSnapshot();
    }

    // The shared getLatestSnapshot()/getSnapshotById() cache stays company-wide and
    // untouched here (ADMIN/VIEWER performance unaffected) — a TEAM_LEADER session
    // only gets a per-request filtered copy of the response, never an unscoped
    // Dataset over the wire. PrincipalSelector.tsx and every lib/timeIntelligence.ts
    // summarizer need no changes: they already just read whatever's in this object.
    const scope = await resolveScopeForSession(session.user.role, session.user.teamLeaderId, session.user.allowedPrincipals);
    if (scope && dataset) {
      const principalKeys = new Set(scope.principals.map(normalizePrincipalKey));
      dataset = filterDatasetToPrincipals(dataset, principalKeys);
    }

    return NextResponse.json({ dataset });
  } catch (err) {
    console.error("Failed to load dataset", err);
    return NextResponse.json({ error: "Failed to load dataset." }, { status: 500 });
  }
}
