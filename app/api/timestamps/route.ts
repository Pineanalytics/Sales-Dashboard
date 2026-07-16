import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import { fetchAllInChunks } from "@/lib/prismaPagination";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  try {
    // Ordered by id (the indexed primary key) — the page re-sorts everything
    // client-side anyway, and date/employeeCode/callSequence isn't fully covered by
    // an index, which would force a re-sort of the whole table on every chunk.
    const calls = await fetchAllInChunks((page) => prisma.repCall.findMany({ orderBy: { id: "asc" }, ...page }));
    return NextResponse.json({ calls });
  } catch (err) {
    console.error("Failed to load Timestamps data", err);
    return NextResponse.json({ error: "Failed to load Timestamps data." }, { status: 500 });
  }
}
