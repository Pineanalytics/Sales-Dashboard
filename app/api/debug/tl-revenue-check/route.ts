import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import { decodeDataset } from "@/lib/snapshotCodec";
import { getCurrentMonthPeriod } from "@/lib/timeIntelligence";

export const runtime = "nodejs";

// TEMPORARY diagnostic route — API-key-gated, read-only, removed once its
// one-off question is answered. Investigating reported TL Ranking MTD Revenue
// misattribution (Erick/EABL-Nyahururu overstated, Richard/EABL-Nyeri
// understated). Computes: (a) ground-truth principal revenue (direct sum,
// no rep-name matching at all), (b) what the OLD name-only-collapsed logic
// would attribute, (c) what the NEW per-row-principal-aware logic attributes.
function hasValidApiKey(req: NextRequest): boolean {
  const expected = process.env.UPLOAD_API_KEY;
  if (!expected) return false;
  const provided = req.headers.get("x-upload-api-key");
  if (!provided) return false;
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  return expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf);
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

export async function GET(req: NextRequest) {
  if (!hasValidApiKey(req)) {
    return NextResponse.json({ error: "Invalid or missing x-upload-api-key." }, { status: 401 });
  }

  const [assignments, teamLeaders, snapshot] = await Promise.all([
    prisma.teamLeaderAssignment.findMany({
      where: { active: true },
      select: { teamLeaderId: true, employeeName: true, sapName: true, principal: true },
    }),
    prisma.teamLeader.findMany({ select: { id: true, name: true } }),
    prisma.snapshot.findFirst({ orderBy: { uploadedAt: "desc" } }),
  ]);
  if (!snapshot) return NextResponse.json({ error: "No snapshot found." }, { status: 404 });
  const dataset = decodeDataset(snapshot.data);
  const period = getCurrentMonthPeriod(dataset);

  const bc = dataset.monthlyBrandCustomer.filter((r) => r.year === period.year && r.month === period.month);

  const groundTruthByPrincipal = new Map<string, number>();
  for (const r of bc) groundTruthByPrincipal.set(r.principal, (groundTruthByPrincipal.get(r.principal) ?? 0) + r.revenue);

  // repRevenue collapsed by NAME ALONE across every principal (the OLD, buggy shape).
  const revenueByNameAllPrincipals = new Map<string, number>();
  for (const r of bc) revenueByNameAllPrincipals.set(r.salesEmployee, (revenueByNameAllPrincipals.get(r.salesEmployee) ?? 0) + r.revenue);

  // repRevenue kept per (name, principal) pair (the NEW shape).
  const revenueByNameAndPrincipal = new Map<string, number>(); // key: name|principal
  for (const r of bc) {
    const key = `${r.salesEmployee}|${r.principal}`;
    revenueByNameAndPrincipal.set(key, (revenueByNameAndPrincipal.get(key) ?? 0) + r.revenue);
  }

  const teamLeaderNameById = new Map(teamLeaders.map((tl) => [tl.id, tl.name]));

  function oldResolve(name: string): string | null {
    const needle = normalizeName(name);
    const bySap = assignments.filter((a) => a.sapName && normalizeName(a.sapName) === needle);
    const byEmp = assignments.filter((a) => normalizeName(a.employeeName) === needle);
    const candidates = bySap.length > 0 ? bySap : byEmp;
    return candidates.length > 0 ? candidates[0].teamLeaderId : null;
  }

  function newResolve(name: string, principal: string): string | null {
    const needle = normalizeName(name);
    const bySap = assignments.filter((a) => a.sapName && normalizeName(a.sapName) === needle);
    const byEmp = assignments.filter((a) => normalizeName(a.employeeName) === needle);
    const candidates = bySap.length > 0 ? bySap : byEmp;
    if (candidates.length === 0) return null;
    const forPrincipal = candidates.find((a) => a.principal === principal);
    return (forPrincipal ?? candidates[0]).teamLeaderId;
  }

  const oldRevenueByTl = new Map<string, number>();
  for (const [name, revenue] of revenueByNameAllPrincipals) {
    const tlId = oldResolve(name);
    if (tlId) oldRevenueByTl.set(tlId, (oldRevenueByTl.get(tlId) ?? 0) + revenue);
  }

  const newRevenueByTl = new Map<string, number>();
  for (const [key, revenue] of revenueByNameAndPrincipal) {
    const sep = key.lastIndexOf("|");
    const name = key.slice(0, sep);
    const principal = key.slice(sep + 1);
    const tlId = newResolve(name, principal);
    if (tlId) newRevenueByTl.set(tlId, (newRevenueByTl.get(tlId) ?? 0) + revenue);
  }

  const summary = teamLeaders.map((tl) => ({
    teamLeaderName: tl.name,
    oldMtdRevenue: oldRevenueByTl.get(tl.id) ?? 0,
    newMtdRevenue: newRevenueByTl.get(tl.id) ?? 0,
  }));

  return NextResponse.json({
    period,
    groundTruthByPrincipal: Object.fromEntries(groundTruthByPrincipal),
    summary,
  });
}
