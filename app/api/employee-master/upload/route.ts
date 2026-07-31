import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import { recomputeDailyTargets, recomputeRepContribution } from "@/lib/repContribution";

export const runtime = "nodejs";

interface EmployeeUploadRow {
  employeeCode: string;
  company: string | null;
  pineName: string;
  sapName: string;
  absolutePrincipal: string;
  salesRole: "Primary Sales" | "Secondary Sales";
  workGroup: string | null;
  region: string | null;
  subRegion: string | null;
  teamLeader: string | null;
  supervisor: string | null;
  active: boolean;
  costCenterCount: number | null;
  salesPoint: string | null;
  route: string | null;
  location: string | null;
}

interface ContributionUploadRow {
  employeeCode: string;
  principal: string;
  salesRole: "Primary Sales" | "Secondary Sales";
  contributionPct: number;
}

function hasValidApiKey(req: NextRequest): boolean {
  const expected = process.env.UPLOAD_API_KEY;
  if (!expected) return false;
  const provided = req.headers.get("x-upload-api-key");
  if (!provided) return false;
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  return expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf);
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNullableText(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isSalesRole(value: unknown): value is EmployeeUploadRow["salesRole"] {
  return value === "Primary Sales" || value === "Secondary Sales";
}

function isEmployeeRow(value: unknown): value is EmployeeUploadRow {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    isText(row.employeeCode) &&
    isNullableText(row.company) &&
    isText(row.pineName) &&
    isText(row.sapName) &&
    isText(row.absolutePrincipal) &&
    isSalesRole(row.salesRole) &&
    isNullableText(row.workGroup) &&
    isNullableText(row.region) &&
    isNullableText(row.subRegion) &&
    isNullableText(row.teamLeader) &&
    isNullableText(row.supervisor) &&
    typeof row.active === "boolean" &&
    (row.costCenterCount === null || (typeof row.costCenterCount === "number" && Number.isInteger(row.costCenterCount))) &&
    isNullableText(row.salesPoint) &&
    isNullableText(row.route) &&
    isNullableText(row.location)
  );
}

function isContributionRow(value: unknown): value is ContributionUploadRow {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return isText(row.employeeCode) && isText(row.principal) && isSalesRole(row.salesRole) && typeof row.contributionPct === "number" && Number.isFinite(row.contributionPct) && row.contributionPct >= 0;
}

/** Receives a vetted Employee Roaster + Contribution import from the local
 * workbook script. Existing Team Leader assignments retain their target owner
 * and manually declared target contribution, but their names/SAP joins/role and
 * active status are refreshed from this canonical master. */
export async function POST(req: NextRequest) {
  if (!hasValidApiKey(req)) {
    return NextResponse.json({ error: "Invalid or missing x-upload-api-key." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Expected JSON with "employees" and "contributions" arrays.' }, { status: 400 });
  }

  const employees = (body as { employees?: unknown })?.employees;
  const contributions = (body as { contributions?: unknown })?.contributions;
  if (!Array.isArray(employees) || !Array.isArray(contributions) || employees.length === 0) {
    return NextResponse.json({ error: '"employees" must be non-empty and "contributions" must be an array.' }, { status: 400 });
  }
  if (!employees.every(isEmployeeRow) || !contributions.every(isContributionRow)) {
    return NextResponse.json({ error: "One or more Employee Roaster rows are invalid." }, { status: 400 });
  }

  const validEmployees = employees as EmployeeUploadRow[];
  const validContributions = contributions as ContributionUploadRow[];
  const employeeCodes = new Set(validEmployees.map((row) => row.employeeCode));
  if (employeeCodes.size !== validEmployees.length) {
    return NextResponse.json({ error: "Employee Roaster contains duplicate UserID values." }, { status: 400 });
  }
  if (validContributions.some((row) => !employeeCodes.has(row.employeeCode))) {
    return NextResponse.json({ error: "Contribution contains a UserID that is missing from Employee Roaster." }, { status: 400 });
  }
  const contributionKeys = new Set(validContributions.map((row) => `${row.employeeCode}|${row.principal}`));
  if (contributionKeys.size !== validContributions.length) {
    return NextResponse.json({ error: "Contribution contains duplicate UserID and Principal pairs." }, { status: 400 });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const masters = await Promise.all(
        validEmployees.map((row) =>
          tx.employeeMaster.upsert({
            where: { employeeCode: row.employeeCode },
            update: { ...row, importedAt: new Date() },
            create: row,
            select: { id: true, employeeCode: true, pineName: true, sapName: true, salesRole: true, teamLeader: true, active: true },
          })
        )
      );
      const masterByCode = new Map(masters.map((row) => [row.employeeCode, row]));

      await tx.employeePrincipalContribution.deleteMany({ where: { employeeId: { in: masters.map((row) => row.id) } } });
      if (validContributions.length > 0) {
        await tx.employeePrincipalContribution.createMany({
          data: validContributions.map((row) => ({
            employeeId: masterByCode.get(row.employeeCode)!.id,
            principal: row.principal,
            salesRole: row.salesRole,
            contributionPct: row.contributionPct,
          })),
        });
      }

      // The source roster provides the initial Team Leader × Rep × relevant
      // Principal grid. Manual target contributions/channels are intentionally
      // not overwritten: the source Contribution percentages are role-normalized
      // master allocations, not a single Team Leader target split.
      const sourceLeaderNames = Array.from(new Set(masters.map((master) => master.teamLeader).filter((name): name is string => !!name)));
      const teamLeaders = await tx.teamLeader.findMany({ select: { id: true, name: true } });
      const teamLeaderByNormalizedName = new Map(teamLeaders.map((leader) => [leader.name.trim().toLowerCase(), leader]));
      for (const name of sourceLeaderNames) {
        const key = name.trim().toLowerCase();
        if (!teamLeaderByNormalizedName.has(key)) {
          const created = await tx.teamLeader.create({ data: { name } });
          teamLeaderByNormalizedName.set(key, created);
        }
      }

      const existingAssignments = await tx.teamLeaderAssignment.findMany({
        where: { employeeCode: { in: masters.map((row) => row.employeeCode) } },
        select: { id: true, employeeCode: true },
      });
      await Promise.all(
        existingAssignments.map((assignment) => {
          const master = masterByCode.get(assignment.employeeCode)!;
          return tx.teamLeaderAssignment.update({
            where: { id: assignment.id },
            data: {
              employeeName: master.pineName,
              sapName: master.sapName,
              active: master.active,
              salesRole: master.salesRole === "Primary Sales" ? "PRIMARY" : "SECONDARY",
            },
          });
        })
      );

      const sourceAssignments = validContributions.flatMap((contribution) => {
        const master = masterByCode.get(contribution.employeeCode)!;
        const teamLeader = master.teamLeader ? teamLeaderByNormalizedName.get(master.teamLeader.trim().toLowerCase()) : undefined;
        if (!teamLeader) return [];
        return [
          tx.teamLeaderAssignment.upsert({
            where: {
              teamLeaderId_employeeCode_principal: {
                teamLeaderId: teamLeader.id,
                employeeCode: master.employeeCode,
                principal: contribution.principal,
              },
            },
            update: {
              employeeName: master.pineName,
              sapName: master.sapName,
              active: master.active,
              salesRole: master.salesRole === "Primary Sales" ? "PRIMARY" : "SECONDARY",
            },
            create: {
              teamLeaderId: teamLeader.id,
              employeeCode: master.employeeCode,
              employeeName: master.pineName,
              sapName: master.sapName,
              principal: contribution.principal,
              active: master.active,
              salesRole: master.salesRole === "Primary Sales" ? "PRIMARY" : "SECONDARY",
            },
          }),
        ];
      });
      await Promise.all(sourceAssignments);

      return {
        employees: masters.length,
        contributions: validContributions.length,
        teamLeaders: sourceLeaderNames.length,
        assignmentsUpdated: existingAssignments.length,
        assignmentsSynced: sourceAssignments.length,
      };
    });

    // Assignment role/status can affect existing target projections right away.
    const contribution = await recomputeRepContribution();
    const daily = await recomputeDailyTargets();
    return NextResponse.json({ ...result, contribution, daily }, { status: 200 });
  } catch (err) {
    console.error("Failed to import Employee Roaster", err);
    return NextResponse.json({ error: "Failed to save Employee Roaster data." }, { status: 500 });
  }
}
