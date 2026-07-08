// Flags reps who haven't shown any field activity (sale, order, or a plain visit/
// "nosale" call) in over a month, from the raw fact rows — not the monthly-coverage
// rollup, since a dormant rep by definition has nothing in the current month's
// aggregate. Independent of Cost Centre resolution/matching: this is about whether
// the person has been in the field at all, not which principal they'd map to.
import type { PineFactRow } from "./query";

const DORMANT_THRESHOLD_DAYS = 30;

export interface DormantRep {
  userId: string;
  employeeName: string;
  userGroup: string | null;
  userRegion: string | null;
  lastActivityDate: string; // yyyy-mm-dd
  daysSinceActivity: number;
}

/** Grouped by userId (stable identity), not employeeName (which has trailing-space
 *  duplicates in the source data — see transform.ts's employeeName.trim() fix). */
export function findDormantReps(rawRows: PineFactRow[], asOfDate: Date): DormantRep[] {
  interface RepInfo {
    employeeName: string;
    userGroup: string | null;
    userRegion: string | null;
    lastActivity: Date;
  }
  const byUserId = new Map<string, RepInfo>();

  for (const r of rawRows) {
    if (!r.userId) continue;
    const existing = byUserId.get(r.userId);
    if (!existing || r.date > existing.lastActivity) {
      byUserId.set(r.userId, {
        employeeName: r.employee.trim(),
        userGroup: r.userGroup,
        userRegion: r.userRegion,
        lastActivity: r.date,
      });
    }
  }

  const dormant: DormantRep[] = [];
  for (const [userId, info] of byUserId) {
    const daysSince = Math.floor((asOfDate.getTime() - info.lastActivity.getTime()) / (1000 * 60 * 60 * 24));
    if (daysSince > DORMANT_THRESHOLD_DAYS) {
      dormant.push({
        userId,
        employeeName: info.employeeName,
        userGroup: info.userGroup,
        userRegion: info.userRegion,
        lastActivityDate: info.lastActivity.toISOString().slice(0, 10),
        daysSinceActivity: daysSince,
      });
    }
  }

  return dormant.sort((a, b) => b.daysSinceActivity - a.daysSinceActivity);
}
