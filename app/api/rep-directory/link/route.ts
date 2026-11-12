import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { REP_SOURCES, type RepSource } from "@/lib/repDirectoryBuild";
import { afterNameChange, getEmployeeCells, getRosterActor, setEmployeeLink } from "@/lib/repLinks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Links a roster employee to a rep-directory identity, or removes the link when "sourceKey" is null. Saves at once; for SAP and Pine the
 *  identity's spelling and code are written to the employee too, and the usual roster recompute runs if the name changed. */
export async function POST(request: NextRequest) {
  const actor = await getRosterActor();
  if (!actor) return NextResponse.json({ error: "Sign in as an admin or team leader." }, { status: 401 });

  let body: { employeeCode?: unknown; source?: unknown; sourceKey?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected {"employeeCode","source","sourceKey"}.' }, { status: 400 });
  }
  const { employeeCode, source, sourceKey } = body;
  if (typeof employeeCode !== "string" || !employeeCode) return NextResponse.json({ error: '"employeeCode" is required.' }, { status: 400 });
  if (typeof source !== "string" || !(REP_SOURCES as readonly string[]).includes(source)) return NextResponse.json({ error: '"source" must be a known rep source.' }, { status: 400 });
  if (sourceKey !== null && (typeof sourceKey !== "string" || !sourceKey)) return NextResponse.json({ error: '"sourceKey" must be a key or null.' }, { status: 400 });
  if (!actor.isAdmin && source !== "SAP" && source !== "PINE") return NextResponse.json({ error: "Only admins can link that source." }, { status: 403 });

  const result = await setEmployeeLink({ employeeCode, source: source as RepSource, sourceKey: sourceKey as string | null, actor });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.error.startsWith("You can only") ? 403 : 400 });
  if (result.nameChanged) await afterNameChange();

  const employee = await prisma.employeeMaster.findUnique({ where: { employeeCode }, select: { employeeCode: true, pineName: true, sapName: true } });
  const cells = employee ? (await getEmployeeCells([employee])).get(employeeCode) : undefined;
  return NextResponse.json({ ok: true, changed: result.changed, sharedWith: result.sharedWith, identityName: result.identityName, cells });
}
