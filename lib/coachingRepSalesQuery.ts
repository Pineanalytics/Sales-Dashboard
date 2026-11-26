// Loads the Rep sales report for a signed-in viewer: the same cached universe and history the Coaching app is fed from, limited to the team leaders
// the viewer may see (lib/coachingBridge.ts coachingScopeForUser).
import type { Session } from "next-auth";
import { coachingScopeForUser } from "@/lib/coachingBridge";
import { buildRepSales, type RepSalesFilters, type RepSalesReport } from "@/lib/coachingRepSales";
import { historySnapshot, universeSnapshot } from "@/lib/universeFeed";

export const REP_SALES_ROLES = ["ADMIN", "TEAM_LEADER", "SUPERVISOR"];

type Params = { month?: string | null; leader?: string | null; principal?: string | null; rep?: string | null; q?: string | null };

export const currentMonth = (now = new Date()) => now.toLocaleDateString("en-CA", { timeZone: "Africa/Nairobi" }).slice(0, 7);

/** The history holds the current year only, so a month outside it falls back to the current month. */
export function monthParam(value: string | null | undefined, now = new Date()): string {
  const latest = currentMonth(now);
  return value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && value.slice(0, 4) === latest.slice(0, 4) && value <= latest ? value : latest;
}

export function repSalesFilters(params: Params, leaders: string[] | null): RepSalesFilters {
  const clean = (value: string | null | undefined) => value?.trim() || undefined;
  return { month: monthParam(params.month), leaders, teamLeader: clean(params.leader), principal: clean(params.principal), repCode: clean(params.rep), search: clean(params.q) };
}

export type RepSalesResult = { report: RepSalesReport; builtAt: string | null; filters: RepSalesFilters } | null;

/** null when the viewer has no Coaching access. */
export async function loadRepSales(user: Session["user"], params: Params): Promise<RepSalesResult> {
  if (!REP_SALES_ROLES.includes(user.role)) return null;
  const scope = await coachingScopeForUser(user);
  if (!scope) return null;
  const filters = repSalesFilters(params, scope.allLeaders ? null : scope.leaderNames);
  const [universe, history] = await Promise.all([universeSnapshot(), historySnapshot()]);
  return { report: buildRepSales(universe.rows, history.rows, filters), builtAt: universe.builtAt, filters };
}
