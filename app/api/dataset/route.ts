import { NextRequest, NextResponse } from "next/server";
import { getLatestSnapshot, getSnapshotById } from "@/lib/datasetStore";
import { auth } from "@/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const id = req.nextUrl.searchParams.get("id");

  try {
    if (id) {
      const dataset = await getSnapshotById(id);
      if (!dataset) {
        return NextResponse.json({ error: `No snapshot found with id "${id}".` }, { status: 404 });
      }
      return NextResponse.json({ dataset });
    }

    const dataset = await getLatestSnapshot();
    return NextResponse.json({ dataset });
  } catch (err) {
    console.error("Failed to load dataset", err);
    return NextResponse.json({ error: "Failed to load dataset." }, { status: 500 });
  }
}
