import { Role as PrismaRole } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { ALL_PAGE_KEYS } from "@/lib/pageAccess";
import {
  ALL_ROLES,
  PRINCIPAL_SCOPED_ROLES,
  ROLE_DEFAULT_PAGES,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  isRole,
  roleLabel,
  roleUsesSupervisorLink,
  roleUsesTeamLeaderLink,
} from "@/lib/roles";

describe("roles", () => {
  it("lists exactly the roles the database knows", () => {
    expect(new Set(ALL_ROLES)).toEqual(new Set(Object.values(PrismaRole)));
  });

  it("labels and describes every role, including the Stores Manager and Sales Rep", () => {
    for (const role of ALL_ROLES) {
      expect(ROLE_LABELS[role]).toBeTruthy();
      expect(ROLE_DESCRIPTIONS[role]).toBeTruthy();
    }
    expect(roleLabel("STORES_MANAGER")).toBe("Stores Manager");
    expect(roleLabel("SALES_REP")).toBe("Sales Rep");
    expect(roleLabel("SOMETHING_ELSE")).toBe("SOMETHING_ELSE");
    expect(isRole("SALES_REP")).toBe(true);
    expect(isRole("sales_rep")).toBe(false);
  });

  it("only offers the Team Leader link to Team Leaders and the Supervisor link to Supervisors", () => {
    for (const role of ALL_ROLES) {
      expect(roleUsesTeamLeaderLink(role)).toBe(role === "TEAM_LEADER");
      expect(roleUsesSupervisorLink(role)).toBe(role === "SUPERVISOR");
    }
  });

  it("lets every non-roster, non-company-wide role be limited to chosen principals", () => {
    expect(PRINCIPAL_SCOPED_ROLES.has("SALES_REP")).toBe(true);
    expect(PRINCIPAL_SCOPED_ROLES.has("STORES_MANAGER")).toBe(true);
    expect(PRINCIPAL_SCOPED_ROLES.has("VIEWER")).toBe(true);
    for (const role of ["ADMIN", "HOD", "DIRECTOR", "TEAM_LEADER", "SUPERVISOR"]) expect(PRINCIPAL_SCOPED_ROLES.has(role)).toBe(false);
  });

  it("starts each role on real reports: everything for viewers and leadership, its own modules for back office, nothing for a rep", () => {
    for (const role of ALL_ROLES) for (const key of ROLE_DEFAULT_PAGES[role]) expect(ALL_PAGE_KEYS).toContain(key);
    expect(ROLE_DEFAULT_PAGES.VIEWER).toEqual(ALL_PAGE_KEYS);
    expect(ROLE_DEFAULT_PAGES.TEAM_LEADER).toEqual(ALL_PAGE_KEYS);
    expect(ROLE_DEFAULT_PAGES.SALES_REP).toEqual([]);
    expect(ROLE_DEFAULT_PAGES.STORES_MANAGER).toEqual(expect.arrayContaining(["stock", "dormant-stock"]));
    expect(ROLE_DEFAULT_PAGES.STORES_MANAGER).not.toContain("receivables");
    expect(ROLE_DEFAULT_PAGES.ACCOUNTANT).toEqual(expect.arrayContaining(["profitability", "receivables"]));
  });
});
