import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { resolveScopeForSession } from "@/lib/teamLeaderScope";
import { exampleToCsv, exampleToXlsx, isUploadKind, UPLOAD_FORMATS } from "@/lib/uploadExamples";
import { loadExampleTable } from "@/lib/uploadExamplesServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// An example file for an admin upload form, built from the data already in the dashboard, in the exact format the upload reads. Admins only,
// except the roster example, which a Supervisor can also open for their own group (the roster upload form is theirs too).
export async function GET(_request: Request, context: { params: Promise<{ kind: string }> }) {
  const { kind } = await context.params;
  if (!isUploadKind(kind)) return NextResponse.json({ error: "Unknown upload." }, { status: 404 });

  const session = await auth();
  const role = session?.user?.role;
  const allowed = role === "ADMIN" || (kind === "roster" && role === "SUPERVISOR");
  if (!session?.user || !allowed) return NextResponse.json({ error: "Not authorized." }, { status: 403 });

  const scope = kind === "roster" ? await resolveScopeForSession(role, session.user.teamLeaderId, session.user.allowedPrincipals, session.user.supervisorId) : null;
  const table = await loadExampleTable(kind, scope);
  if (table.rows.length === 0) return NextResponse.json({ error: "There is no data of this kind in the dashboard yet to build an example from." }, { status: 404 });

  const format = UPLOAD_FORMATS[kind];
  const headers = { "Content-Disposition": `attachment; filename="${format.filename}"`, "Cache-Control": "no-store" };
  if (format.fileType === "csv") {
    return new NextResponse(exampleToCsv(table), { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8" } });
  }
  // The Upfield export starts with a banner row above its headers; the example keeps it so the shape matches the real file.
  const today = new Date().toISOString().slice(0, 10);
  const banner = kind === "upfield-outlets" ? [`From: ${today.slice(0, 4)}-01-01 To: ${today}`] : undefined;
  const buffer = exampleToXlsx(table, { sheetName: format.sheetName ?? "Sheet1", banner });
  return new NextResponse(new Uint8Array(buffer), {
    headers: { ...headers, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  });
}
