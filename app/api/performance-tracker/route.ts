import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { resolveScopeForSession } from "@/lib/teamLeaderScope";
import { allMetricsFor, sectionsFor } from "@/lib/performanceTracker/definitions";
import { autoPopulateActuals } from "@/lib/performanceTracker/autoPopulate";
import { canAccessPerformanceTracker } from "@/lib/performanceTracker/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isValidPeriod(period: string | null): period is string {
  return !!period && /^\d{4}-\d{2}$/.test(period);
}

// Prisma's generated compound-unique WHERE shortcut (type_periodMonth_teamLeaderId)
// doesn't accept null for the nullable teamLeaderId member — a real Prisma
// limitation on @@unique constraints involving a nullable column, not a schema
// mistake (teamLeaderId genuinely must stay nullable: null is what makes a
// tracker company-wide/HOD). find-then-create/update sidesteps it; findFirst
// itself has no such restriction on null in a plain WHERE.
async function findOrCreateTracker(type: "HOD" | "TEAM_LEADER", periodMonth: string, teamLeaderId: string | null, createdByUserId: string) {
  const existing = await prisma.performanceTracker.findFirst({ where: { type, periodMonth, teamLeaderId } });
  if (existing) return existing;
  return prisma.performanceTracker.create({ data: { type, periodMonth, teamLeaderId, createdByUserId } });
}

/** GET ?type=HOD|TEAM_LEADER&period=YYYY-MM[&teamLeaderId=...] — fetches (and
 *  lazily creates, same "generate on first read" pattern WeeklyTarget already
 *  uses) the tracker for that period, then fills any still-empty auto-sourced
 *  metric with a fresh live value before returning — a manual entry already
 *  present is never touched. */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (!canAccessPerformanceTracker(session.user.role)) {
    return NextResponse.json({ error: "The Performance Tracker is still being built — admin-only for now." }, { status: 403 });
  }

  const type = req.nextUrl.searchParams.get("type");
  const period = req.nextUrl.searchParams.get("period");
  const teamLeaderId = req.nextUrl.searchParams.get("teamLeaderId");
  if (type !== "HOD" && type !== "TEAM_LEADER") {
    return NextResponse.json({ error: '"type" must be HOD or TEAM_LEADER.' }, { status: 400 });
  }
  if (!isValidPeriod(period)) return NextResponse.json({ error: '"period" must be YYYY-MM.' }, { status: 400 });

  const role = session.user.role;
  if (type === "HOD") {
    if (!["HOD", "DIRECTOR", "ADMIN"].includes(role)) {
      return NextResponse.json({ error: "Not authorized to view the HOD tracker." }, { status: 403 });
    }
  } else {
    if (!teamLeaderId) return NextResponse.json({ error: '"teamLeaderId" is required for the Team Leader tracker.' }, { status: 400 });
    if (role === "TEAM_LEADER") {
      if (session.user.teamLeaderId !== teamLeaderId) {
        return NextResponse.json({ error: "You can only view your own tracker." }, { status: 403 });
      }
    } else if (role === "SUPERVISOR") {
      const scope = await resolveScopeForSession(role, session.user.teamLeaderId, session.user.allowedPrincipals, session.user.supervisorId);
      if (!scope?.teamLeaderIds.includes(teamLeaderId)) {
        return NextResponse.json({ error: "Not authorized to view this Team Leader's tracker." }, { status: 403 });
      }
    } else if (role !== "ADMIN") {
      return NextResponse.json({ error: "Not authorized to view the Team Leader tracker." }, { status: 403 });
    }
  }

  const scopedTeamLeaderId = type === "HOD" ? null : teamLeaderId;
  const created = await findOrCreateTracker(type, period, scopedTeamLeaderId, session.user.id);
  let tracker = await prisma.performanceTracker.findUniqueOrThrow({
    where: { id: created.id },
    include: { metrics: true, repRows: { orderBy: { sortOrder: "asc" } } },
  });

  // Auto-populate — the Team Leader tracker scopes to that TL's own reps
  // (loadTeamLeaderScope), the HOD tracker is company-wide (null scope).
  const scopeForAuto =
    type === "HOD"
      ? null
      : { employeeCodes: (await resolveScopeForSession("TEAM_LEADER", teamLeaderId, [], null))?.employeeCodes ?? [] };
  const auto = await autoPopulateActuals(period, scopeForAuto);

  const byKey = new Map(tracker.metrics.map((m) => [m.metricKey, m]));
  const toUpsert: { metricKey: string; actual: number }[] = [];
  for (const def of allMetricsFor(type)) {
    if (!def.autoSource) continue;
    const value = auto[def.autoSource];
    if (value === undefined) continue;
    const existing = byKey.get(def.key);
    if (!existing || existing.actual === null) toUpsert.push({ metricKey: def.key, actual: value });
  }
  if (toUpsert.length > 0) {
    await prisma.$transaction(
      toUpsert.map((m) =>
        prisma.performanceTrackerMetric.upsert({
          where: { trackerId_metricKey: { trackerId: tracker.id, metricKey: m.metricKey } },
          update: { actual: m.actual },
          create: { trackerId: tracker.id, metricKey: m.metricKey, actual: m.actual },
        })
      )
    );
    tracker = await prisma.performanceTracker.findUniqueOrThrow({
      where: { id: tracker.id },
      include: { metrics: true, repRows: { orderBy: { sortOrder: "asc" } } },
    });
  }

  return NextResponse.json({ tracker, sections: sectionsFor(type) });
}

/** PUT — upserts a tracker's own fields (reviewedByName, mdDiscretionaryPct,
 *  status, reviewComments) and its metric target/actual rows, in one call.
 *  Which fields a given role may actually change is enforced server-side
 *  (canEditValues / canReview below), not trusted from the request — the
 *  client only ever renders the fields that role can see anyway, but this is
 *  the real boundary. */
export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (!canAccessPerformanceTracker(session.user.role)) {
    return NextResponse.json({ error: "The Performance Tracker is still being built — admin-only for now." }, { status: 403 });
  }
  const role = session.user.role;

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  const { type, periodMonth, teamLeaderId, metrics, reviewedByName, mdDiscretionaryPct, status, reviewComments } = body;

  if (type !== "HOD" && type !== "TEAM_LEADER") return NextResponse.json({ error: '"type" must be HOD or TEAM_LEADER.' }, { status: 400 });
  if (!isValidPeriod(periodMonth)) return NextResponse.json({ error: '"periodMonth" must be YYYY-MM.' }, { status: 400 });

  let canEditValues = false;
  let canReview = false;
  if (type === "HOD") {
    canEditValues = role === "HOD" || role === "ADMIN";
    canReview = role === "DIRECTOR" || role === "ADMIN";
  } else {
    if (!teamLeaderId) return NextResponse.json({ error: '"teamLeaderId" is required.' }, { status: 400 });
    canEditValues = (role === "TEAM_LEADER" && session.user.teamLeaderId === teamLeaderId) || role === "ADMIN";
    if (role === "SUPERVISOR") {
      const scope = await resolveScopeForSession(role, session.user.teamLeaderId, session.user.allowedPrincipals, session.user.supervisorId);
      canReview = !!scope?.teamLeaderIds.includes(teamLeaderId);
    } else {
      canReview = role === "ADMIN";
    }
  }
  if (!canEditValues && !canReview) return NextResponse.json({ error: "Not authorized to edit this tracker." }, { status: 403 });

  const resolvedTeamLeaderId = type === "HOD" ? null : (teamLeaderId as string);
  const created = await findOrCreateTracker(type, periodMonth, resolvedTeamLeaderId, session.user.id);
  const tracker = await prisma.performanceTracker.update({
    where: { id: created.id },
    data: {
      ...(canEditValues && reviewedByName !== undefined ? { reviewedByName: reviewedByName || null } : {}),
      ...(canEditValues && type === "HOD" && mdDiscretionaryPct !== undefined
        ? { mdDiscretionaryPct: mdDiscretionaryPct === "" || mdDiscretionaryPct === null ? null : Number(mdDiscretionaryPct) }
        : {}),
      ...(canReview && status !== undefined ? { status } : {}),
      ...(canReview && reviewComments !== undefined ? { reviewComments: reviewComments || null } : {}),
    },
  });

  if (canEditValues && Array.isArray(metrics)) {
    const validKeys = new Set(allMetricsFor(type).map((m) => m.key));
    const valid = metrics.filter((m: unknown): m is { key: string; target?: number | null; actual?: number | null } => {
      const row = m as { key?: unknown };
      return typeof row?.key === "string" && validKeys.has(row.key);
    });
    if (valid.length > 0) {
      await prisma.$transaction(
        valid.map((m) =>
          prisma.performanceTrackerMetric.upsert({
            where: { trackerId_metricKey: { trackerId: tracker.id, metricKey: m.key } },
            update: { target: m.target ?? null, actual: m.actual ?? null },
            create: { trackerId: tracker.id, metricKey: m.key, target: m.target ?? null, actual: m.actual ?? null },
          })
        )
      );
    }
  }

  return NextResponse.json({ ok: true, trackerId: tracker.id });
}
