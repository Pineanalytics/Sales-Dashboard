// Shared source of truth for which report pages exist, used by both
// Sidebar.tsx (filters nav links down to a non-admin's allowedPages) and
// AnalyticsShell.tsx (gates page content by the current pathname). The
// values here are also exactly what's stored in User.allowedPages, so a
// user's DB row maps onto routes with no separate translation table.

export const ALL_PAGE_KEYS = [
  "frost",
  "insights",
  "executive-summary",
  "finance-presentation",
  "commercial-performance",
  "dashboard",
  "sales",
  "performance-analysis",
  "time-intelligence",
  "coverage",
  "reps",
  "customers",
  "profitability",
  "receivables",
  "stock",
  "dormant-stock",
  "active-outlets",
  "timestamps",
  "jp-adherence",
  "order-360",
  "principal-kpis",
  "sales-returns",
  "reports",
] as const;

export type PageKey = (typeof ALL_PAGE_KEYS)[number];

// Kept in sync with Sidebar.tsx's NAV_ITEMS labels by convention (Sidebar owns
// icons too, so isn't reused directly here to avoid a server-page → "use
// client" module import).
export const PAGE_LABELS: Record<PageKey, string> = {
  frost: "Frost",
  insights: "Insights",
  "executive-summary": "Executive Summary",
  "finance-presentation": "Finance Presentation",
  "commercial-performance": "Commercial Performance",
  dashboard: "Executive Overview",
  sales: "Sales Performance",
  "performance-analysis": "Performance Analysis",
  "time-intelligence": "Time Intelligence",
  coverage: "Coverage & Productivity",
  reps: "Rep Performance",
  customers: "Customers & Brands",
  profitability: "Financials – Profitability",
  receivables: "Financials – Receivables & Ageing",
  stock: "Stock & Operations",
  "dormant-stock": "Dormant OOS",
  "active-outlets": "Active Outlets",
  timestamps: "Timestamps",
  "jp-adherence": "JP Adherence",
  "order-360": "Order 360",
  "principal-kpis": "Principal KPIs",
  "sales-returns": "Sales & Returns",
  reports: "Reports",
};

export function isPageKey(value: string): value is PageKey {
  return (ALL_PAGE_KEYS as readonly string[]).includes(value);
}

/** One report inside a module: a grantable page key and how the admin access picker names it. */
export interface ReportOption {
  key: PageKey;
  label: string;
  detail?: string;
}

/** A sidebar module and the reports inside it. A module opens when any one of its reports is granted; each report's tab or
 *  section inside the module then shows only if that report itself is granted. Mirrors Sidebar.tsx's NAV_ITEMS order. */
export interface ReportModule {
  id: string;
  label: string;
  href: string;
  reports: readonly ReportOption[];
}

export const REPORT_MODULES: readonly ReportModule[] = [
  { id: "frost", label: "Frost", href: "/frost", reports: [{ key: "frost", label: "Frost" }] },
  { id: "insights", label: "Insights", href: "/insights", reports: [{ key: "insights", label: "Insights" }] },
  { id: "executive-summary", label: "Executive Summary", href: "/executive-summary", reports: [{ key: "executive-summary", label: "Executive Summary" }] },
  { id: "commercial-performance", label: "Commercial Performance", href: "/commercial-performance", reports: [{ key: "commercial-performance", label: "Commercial Performance" }] },
  {
    id: "sales",
    label: "Sales Performance",
    href: "/sales",
    reports: [
      { key: "sales", label: "Sales cockpit" },
      { key: "dashboard", label: "Executive overview" },
      { key: "time-intelligence", label: "Time intelligence" },
      { key: "reps", label: "Rep performance" },
      { key: "customers", label: "Customers & brands" },
    ],
  },
  { id: "performance-analysis", label: "Performance Analysis", href: "/performance-analysis", reports: [{ key: "performance-analysis", label: "Performance Analysis" }] },
  {
    id: "coverage",
    label: "Coverage & Productivity",
    href: "/coverage",
    reports: [
      { key: "coverage", label: "Overview & rep coverage" },
      { key: "active-outlets", label: "Active outlets & universe" },
      { key: "jp-adherence", label: "JP adherence" },
      { key: "timestamps", label: "Timestamps & time in trade" },
    ],
  },
  {
    id: "financials",
    label: "Financials",
    href: "/financials",
    reports: [
      { key: "receivables", label: "Receivables & ageing", detail: "Credit exposure, open items, debtors, ageing trend, global ageing" },
      { key: "profitability", label: "Profitability", detail: "Profitability and sales performance by principal" },
      { key: "finance-presentation", label: "Finance presentation", detail: "Comes with Profitability" },
    ],
  },
  { id: "stock", label: "Stock & Operations", href: "/stock", reports: [{ key: "stock", label: "Stock & Operations" }] },
  { id: "dormant-stock", label: "Dormant OOS", href: "/dormant-stock", reports: [{ key: "dormant-stock", label: "Dormant OOS" }] },
  { id: "order-360", label: "Order 360", href: "/order-360", reports: [{ key: "order-360", label: "Order 360" }] },
  { id: "principal-kpis", label: "Principal KPIs", href: "/principal-kpis", reports: [{ key: "principal-kpis", label: "Principal KPIs" }] },
  { id: "sales-returns", label: "Sales & Returns", href: "/sales-returns", reports: [{ key: "sales-returns", label: "Sales & Returns" }] },
  { id: "reports", label: "Reports", href: "/reports", reports: [{ key: "reports", label: "Report extracts" }] },
];

/** A report that only shows alongside another: the Finance Presentation summarises profitability, so it needs Profitability. */
export const REPORT_REQUIRES: Partial<Record<PageKey, readonly PageKey[]>> = {
  "finance-presentation": ["profitability"],
};

/** The granted reports that actually take effect: known keys only, and a report whose prerequisite isn't granted is dropped. */
export function effectivePages(allowedPages: readonly string[]): Set<PageKey> {
  const pages = new Set(allowedPages.filter(isPageKey));
  for (const [key, needs] of Object.entries(REPORT_REQUIRES) as [PageKey, readonly PageKey[]][]) {
    if (pages.has(key) && !needs.every((need) => pages.has(need))) pages.delete(key);
  }
  return pages;
}

/** Ticks or unticks reports with their prerequisites kept in step: ticking Finance presentation also ticks Profitability, and
 *  unticking Profitability also unticks Finance presentation. */
export function toggleReports(selected: ReadonlySet<PageKey>, keys: readonly PageKey[], on: boolean): Set<PageKey> {
  const next = new Set(selected);
  for (const key of keys) {
    if (on) {
      next.add(key);
      for (const need of REPORT_REQUIRES[key] ?? []) next.add(need);
    } else {
      next.delete(key);
      for (const [dependent, needs] of Object.entries(REPORT_REQUIRES) as [PageKey, readonly PageKey[]][]) {
        if (needs.includes(key)) next.delete(dependent);
      }
    }
  }
  return next;
}

/** effectivePages as a stored list, in catalogue order — what the admin save writes to User.allowedPages. */
export function normalizeAllowedPages(allowedPages: readonly string[]): PageKey[] {
  const pages = effectivePages(allowedPages);
  return ALL_PAGE_KEYS.filter((key) => pages.has(key));
}

/** Pages every approved, logged-in user gets regardless of their allowedPages
 * grant (or a Team Leader/Supervisor visiblePages override) — visibility here
 * is universal, and the underlying DATA is scoped per-user instead (see
 * resolveScopeForSession / lib/teamLeaderScope.ts). A Sales Rep is the
 * exception: they see only what an admin ticked for them. */
export const BASELINE_PAGE_KEYS: readonly PageKey[] = ["principal-kpis"];
const NO_BASELINE_ROLES: ReadonlySet<string> = new Set(["SALES_REP"]);

export function isBaselinePage(pageKey: PageKey | null, role?: string | null): boolean {
  if (pageKey === null || (role && NO_BASELINE_ROLES.has(role))) return false;
  return (BASELINE_PAGE_KEYS as readonly string[]).includes(pageKey);
}

/** Whether this login sees one report (one page key). */
export function canSeeReport(role: string | null | undefined, allowedPages: readonly string[], key: PageKey): boolean {
  return role === "ADMIN" || isBaselinePage(key, role) || effectivePages(allowedPages).has(key);
}

/** Whether this login can open a module: any one of its reports is enough. */
export function canAccessModule(module: ReportModule, role: string | null | undefined, allowedPages: readonly string[] = []): boolean {
  return module.reports.some((report) => canSeeReport(role, allowedPages, report.key));
}

export function moduleById(id: string): ReportModule {
  const found = REPORT_MODULES.find((module) => module.id === id);
  if (!found) throw new Error(`Unknown report module "${id}".`);
  return found;
}

/** The module a route belongs to, by its first path segment ("/coverage?tab=x" and "/coverage/y" are both Coverage). */
export function moduleForPathname(pathname: string | null): ReportModule | null {
  if (!pathname) return null;
  const segment = pathname.split("?")[0].split("/")[1] ?? "";
  return REPORT_MODULES.find((module) => module.href === `/${segment}`) ?? null;
}

/** Financials combines the existing profitability and receivables permissions.
 * Existing user grants remain valid; no user needs a new permission merely
 * because the two reports are now presented in one major module. */
export function canAccessFinancials(role: string | null | undefined, allowedPages: readonly string[] = []): boolean {
  return canAccessModule(moduleById("financials"), role, allowedPages);
}

/** Coverage & Productivity hosts Active Outlets, JP Adherence, and the full
 * Timestamps hub (Pine/EABL/Upfield/Unilever) as tabs. Any one of those grants
 * opens the module; each tab then shows only when its own report is granted. */
export function canAccessCoverage(role: string | null | undefined, allowedPages: readonly string[] = []): boolean {
  return canAccessModule(moduleById("coverage"), role, allowedPages);
}

/** Where a login lands after signing in: Executive Summary when they have it, a Sales Rep's own My Sales when linked, else the
 *  first module they can open (the AI pages last), else My Sales, else Executive Summary (which then says they have no access). */
export function landingPathFor(role: string | null | undefined, allowedPages: readonly string[], hasEmployeeCode: boolean): string {
  const executiveSummary = moduleById("executive-summary");
  if (canAccessModule(executiveSummary, role, allowedPages)) return executiveSummary.href;
  if (role === "SALES_REP" && hasEmployeeCode) return "/my-sales";
  const ordered = [...REPORT_MODULES.filter((m) => m.id !== "frost" && m.id !== "insights"), moduleById("frost"), moduleById("insights")];
  const first = ordered.find((module) => canAccessModule(module, role, allowedPages));
  if (first) return first.href;
  return hasEmployeeCode ? "/my-sales" : executiveSummary.href;
}

/** The outlet cleanup is its own module, open by role rather than by a page grant: team leaders and supervisors work their outlets, an admin reviews, and HOD and
 *  Director can view. Its data is scoped to the person (lib/outletCleanup/access.ts). */
export function canAccessOutletCleanup(role: string | null | undefined): boolean {
  return role === "ADMIN" || role === "TEAM_LEADER" || role === "SUPERVISOR" || role === "HOD" || role === "DIRECTOR";
}

/** Maps a pathname like "/coverage" or "/coverage/some-sub-route" to its page
 *  key, or null if the pathname isn't one of the gated report routes (e.g.
 *  "/admin/users", which has its own separate ADMIN-only gate). */
export function pageKeyForPathname(pathname: string | null): PageKey | null {
  if (!pathname) return null;
  const segment = pathname.split("/")[1] ?? "";
  return isPageKey(segment) ? segment : null;
}
