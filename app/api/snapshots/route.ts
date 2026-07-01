import { NextResponse } from "next/server";
import { listSnapshots } from "@/lib/datasetStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const snapshots = await listSnapshots(20);
    return NextResponse.json({ snapshots });
  } catch (err) {
    console.error("Failed to list snapshots", err);
    return NextResponse.json({ error: "Failed to list snapshots." }, { status: 500 });
  }
}
