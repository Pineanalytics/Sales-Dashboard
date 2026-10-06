import { prisma } from "@/lib/db";
import type { PerformanceSnapshotPayload } from "./types";

export interface StoredPerformanceSnapshot {
  year: number;
  generatedAt: Date;
  payload: PerformanceSnapshotPayload;
}

/** True when `value` has the shape a snapshot must have to be stored or rendered. */
export function isPerformanceSnapshotPayload(value: unknown): value is PerformanceSnapshotPayload {
  if (typeof value !== "object" || value === null) return false;
  const snapshot = value as Record<string, unknown>;
  const hasReport = (report: unknown) => {
    if (typeof report !== "object" || report === null) return false;
    const r = report as Record<string, unknown>;
    return Array.isArray(r.months) && Array.isArray(r.principals) && Array.isArray(r.monthly) && typeof r.kpi === "object" && r.kpi !== null;
  };
  return (
    snapshot.version === 1 &&
    typeof snapshot.generatedAt === "string" &&
    typeof snapshot.asOf === "string" &&
    typeof snapshot.lineCount === "number" &&
    hasReport(snapshot.dashboard) &&
    hasReport(snapshot.recorded)
  );
}

/** The most recent calendar year's stored report, or null when the SAP job has not produced one yet. */
export async function getLatestPerformanceSnapshot(): Promise<StoredPerformanceSnapshot | null> {
  const row = await prisma.performanceAnalysisSnapshot.findFirst({ orderBy: { year: "desc" } });
  if (!row || !isPerformanceSnapshotPayload(row.payload)) return null;
  return { year: row.year, generatedAt: row.generatedAt, payload: row.payload };
}
