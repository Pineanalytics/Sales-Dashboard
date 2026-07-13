// Shared source of truth for which report pages exist, used by both
// Sidebar.tsx (filters nav links down to a non-admin's allowedPages) and
// AnalyticsShell.tsx (gates page content by the current pathname). The
// values here are also exactly what's stored in User.allowedPages, so a
// user's DB row maps onto routes with no separate translation table.

export const ALL_PAGE_KEYS = [
  "dashboard",
  "sales",
  "time-intelligence",
  "coverage",
  "reps",
  "customers",
  "profitability",
  "stock",
  "active-outlets",
  "timestamps",
  "reports",
] as const;

export type PageKey = (typeof ALL_PAGE_KEYS)[number];

// Kept in sync with Sidebar.tsx's NAV_ITEMS labels by convention (Sidebar owns
// icons too, so isn't reused directly here to avoid a server-page → "use
// client" module import).
export const PAGE_LABELS: Record<PageKey, string> = {
  dashboard: "Executive Overview",
  sales: "Sales Performance",
  "time-intelligence": "Time Intelligence",
  coverage: "Coverage & Productivity",
  reps: "Rep Performance",
  customers: "Customers & Brands",
  profitability: "Profitability",
  stock: "Stock Balance",
  "active-outlets": "Active Outlets",
  timestamps: "Timestamps",
  reports: "Reports",
};

export function isPageKey(value: string): value is PageKey {
  return (ALL_PAGE_KEYS as readonly string[]).includes(value);
}

/** Maps a pathname like "/coverage" or "/coverage/some-sub-route" to its page
 *  key, or null if the pathname isn't one of the gated report routes (e.g.
 *  "/admin/users", which has its own separate ADMIN-only gate). */
export function pageKeyForPathname(pathname: string | null): PageKey | null {
  if (!pathname) return null;
  const segment = pathname.split("/")[1] ?? "";
  return isPageKey(segment) ? segment : null;
}
