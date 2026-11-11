// Every login role, its label, what it is for, and which settings apply to it — the one list the admin
// screens, the header badge and the data-scoping code all read, instead of each keeping its own copy.
// Must match the Role enum in prisma/schema.prisma (tests/roles.test.ts checks it).
import { ALL_PAGE_KEYS, type PageKey } from "./pageAccess";

export const ALL_ROLES = [
  "ADMIN",
  "VIEWER",
  "HOD",
  "DIRECTOR",
  "SUPERVISOR",
  "TEAM_LEADER",
  "SALES_REP",
  "SALES_ADMIN",
  "FINANCE_MANAGER",
  "ACCOUNTANT",
  "LOGISTICS_MANAGER",
  "STORES_MANAGER",
] as const;

export type Role = (typeof ALL_ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ALL_ROLES as readonly string[]).includes(value);
}

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Admin",
  VIEWER: "Viewer",
  HOD: "Head of Sales",
  DIRECTOR: "Director",
  SUPERVISOR: "Sales Supervisor",
  TEAM_LEADER: "Team Leader",
  SALES_REP: "Sales Rep",
  SALES_ADMIN: "Sales Admin",
  FINANCE_MANAGER: "Finance Manager",
  ACCOUNTANT: "Accountant",
  LOGISTICS_MANAGER: "Logistics Manager",
  STORES_MANAGER: "Stores Manager",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  ADMIN: "Sees everything and manages the system",
  VIEWER: "Reads the reports they are given",
  HOD: "Fills the company-wide HOD tracker",
  DIRECTOR: "Reviews the HOD tracker",
  SUPERVISOR: "Manages their Team Leader group's roster and targets",
  TEAM_LEADER: "Enters their own team's weekly targets",
  SALES_REP: "Only the reports ticked for them, plus My Sales",
  SALES_ADMIN: "Administrative support for the sales function",
  FINANCE_MANAGER: "Financials, receivables and profitability",
  ACCOUNTANT: "Receivables and profitability",
  LOGISTICS_MANAGER: "Stock, orders and returns",
  STORES_MANAGER: "Stock balance, dormant stock and orders",
};

/** Roles whose data can be narrowed to chosen principals (User.allowedPrincipals). Team Leaders and Supervisors are scoped by
 *  their roster instead; Admin, Head of Sales and Director are company-wide. */
export const PRINCIPAL_SCOPED_ROLES: ReadonlySet<string> = new Set<Role>([
  "VIEWER",
  "SALES_REP",
  "SALES_ADMIN",
  "FINANCE_MANAGER",
  "ACCOUNTANT",
  "LOGISTICS_MANAGER",
  "STORES_MANAGER",
]);

/** Only a Team Leader login is linked to a Team Leader roster row, and only a Sales Supervisor login to a Supervisor row. */
export const roleUsesTeamLeaderLink = (role: string): boolean => role === "TEAM_LEADER";
export const roleUsesSupervisorLink = (role: string): boolean => role === "SUPERVISOR";

const ALL: readonly PageKey[] = ALL_PAGE_KEYS;

/** The reports a new login of each role starts with (on create and on approve), and what "Apply role defaults" ticks. Viewers
 *  and the sales leadership keep every report, as before; the back-office roles start on the modules their work is about; a
 *  Sales Rep starts with nothing, so an admin decides exactly what they see. */
export const ROLE_DEFAULT_PAGES: Record<Role, readonly PageKey[]> = {
  ADMIN: ALL,
  VIEWER: ALL,
  HOD: ALL,
  DIRECTOR: ALL,
  SUPERVISOR: ALL,
  TEAM_LEADER: ALL,
  SALES_REP: [],
  SALES_ADMIN: [
    "executive-summary",
    "commercial-performance",
    "sales",
    "dashboard",
    "time-intelligence",
    "reps",
    "customers",
    "performance-analysis",
    "coverage",
    "active-outlets",
    "jp-adherence",
    "timestamps",
    "order-360",
    "principal-kpis",
    "sales-returns",
    "reports",
  ],
  FINANCE_MANAGER: ["executive-summary", "sales", "performance-analysis", "profitability", "receivables", "finance-presentation", "reports"],
  ACCOUNTANT: ["profitability", "receivables", "reports"],
  LOGISTICS_MANAGER: ["stock", "dormant-stock", "order-360", "sales-returns", "reports"],
  STORES_MANAGER: ["stock", "dormant-stock", "order-360", "reports"],
};

export function roleLabel(role: string): string {
  return isRole(role) ? ROLE_LABELS[role] : role;
}
