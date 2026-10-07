import { gzipSync } from "node:zlib";
import { NextRequest, NextResponse } from "next/server";
import { getLiveDataset, getSnapshotById, filterDatasetToPrincipals } from "@/lib/datasetStore";
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
      dataset = await getLiveDataset();
    }

    // The shared getLiveDataset()/getSnapshotById() cache stays company-wide and
    // untouched here (ADMIN/VIEWER performance unaffected) — a TEAM_LEADER session
    // only gets a per-request filtered copy of the response, never an unscoped
    // Dataset over the wire. PrincipalSelector.tsx and every lib/timeIntelligence.ts
    // summarizer need no changes: they already just read whatever's in this object.
    const scope = await resolveScopeForSession(session.user.role, session.user.teamLeaderId, session.user.allowedPrincipals, session.user.supervisorId);
    if (scope && dataset) {
      const principalKeys = new Set(scope.principals.map(normalizePrincipalKey));
      dataset = filterDatasetToPrincipals(dataset, principalKeys);
    }

    // The dataset is a ~1.5 MB JSON document that the browser must download before most analytics pages can
    // draw. It compresses roughly tenfold, and on a modest connection the download was the whole delay, so it
    // is sent gzip-compressed whenever the client accepts it.
    const body = JSON.stringify({ dataset });
    if (/\bgzip\b/.test(req.headers.get("accept-encoding") ?? "")) {
      return new NextResponse(new Uint8Array(gzipSync(body)), {
        headers: { "Content-Type": "application/json", "Content-Encoding": "gzip", Vary: "Accept-Encoding" },
      });
    }
    return new NextResponse(body, { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    console.error("Failed to load dataset", err);
    return NextResponse.json({ error: "Failed to load dataset." }, { status: 500 });
  }
}
