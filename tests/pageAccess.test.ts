import { describe, expect, it } from "vitest";
import {
  ALL_PAGE_KEYS,
  REPORT_MODULES,
  canAccessCoverage,
  canAccessFinancials,
  canAccessModule,
  canSeeReport,
  isBaselinePage,
  landingPathFor,
  moduleById,
  moduleForPathname,
  normalizeAllowedPages,
  toggleReports,
} from "@/lib/pageAccess";

describe("canAccessFinancials", () => {
  it("retains access for either existing Financials permission", () => {
    expect(canAccessFinancials("USER", ["receivables"])).toBe(true);
    expect(canAccessFinancials("USER", ["profitability"])).toBe(true);
  });

  it("allows administrators and rejects unrelated access", () => {
    expect(canAccessFinancials("ADMIN", [])).toBe(true);
    expect(canAccessFinancials("USER", ["coaching"])).toBe(false);
  });

  it("does not open Financials on a Finance Presentation grant alone", () => {
    expect(canAccessFinancials("VIEWER", ["finance-presentation"])).toBe(false);
  });
});

describe("the report module catalogue", () => {
  it("puts every report in exactly one module", () => {
    const keys = REPORT_MODULES.flatMap((module) => module.reports.map((report) => report.key));
    expect([...keys].sort()).toEqual([...ALL_PAGE_KEYS].sort());
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("maps a route to its module by the first path segment", () => {
    expect(moduleForPathname("/coverage")?.id).toBe("coverage");
    expect(moduleForPathname("/coverage/anything")?.id).toBe("coverage");
    expect(moduleForPathname("/financials?tab=global-ageing")?.id).toBe("financials");
    expect(moduleForPathname("/reps")).toBeNull();
    expect(moduleForPathname("/admin/users")).toBeNull();
    expect(moduleForPathname(null)).toBeNull();
  });
});

describe("module and report access", () => {
  it("opens Sales Performance on any one of its sections, e.g. Rep performance alone", () => {
    const sales = moduleById("sales");
    expect(canAccessModule(sales, "VIEWER", ["reps"])).toBe(true);
    expect(canSeeReport("VIEWER", ["reps"], "sales")).toBe(false);
    expect(canAccessModule(sales, "VIEWER", ["stock"])).toBe(false);
  });

  it("opens Coverage on one tab's report without granting the others", () => {
    expect(canAccessCoverage("VIEWER", ["jp-adherence"])).toBe(true);
    expect(canSeeReport("VIEWER", ["jp-adherence"], "coverage")).toBe(false);
    expect(canSeeReport("VIEWER", ["jp-adherence"], "timestamps")).toBe(false);
  });

  it("shows the Finance Presentation only alongside Profitability", () => {
    expect(canSeeReport("VIEWER", ["finance-presentation"], "finance-presentation")).toBe(false);
    expect(canSeeReport("VIEWER", ["finance-presentation", "profitability"], "finance-presentation")).toBe(true);
    expect(canSeeReport("VIEWER", ["profitability"], "finance-presentation")).toBe(false);
  });

  it("gives everyone Principal KPIs except a Sales Rep, who sees only what was ticked", () => {
    expect(isBaselinePage("principal-kpis", "VIEWER")).toBe(true);
    expect(isBaselinePage("principal-kpis", "SALES_REP")).toBe(false);
    expect(canAccessModule(moduleById("principal-kpis"), "VIEWER", [])).toBe(true);
    expect(canAccessModule(moduleById("principal-kpis"), "SALES_REP", [])).toBe(false);
    expect(canAccessModule(moduleById("principal-kpis"), "SALES_REP", ["principal-kpis"])).toBe(true);
  });

  it("lets an administrator see everything", () => {
    for (const reportModule of REPORT_MODULES) expect(canAccessModule(reportModule, "ADMIN", [])).toBe(true);
  });
});

describe("toggleReports and normalizeAllowedPages", () => {
  it("ticks a report's prerequisite with it, and unticks dependents with a prerequisite", () => {
    expect([...toggleReports(new Set(), ["finance-presentation"], true)].sort()).toEqual(["finance-presentation", "profitability"]);
    expect([...toggleReports(new Set(["finance-presentation", "profitability", "stock"] as const), ["profitability"], false)]).toEqual(["stock"]);
  });

  it("stores known reports only, in catalogue order, dropping one whose prerequisite is missing", () => {
    expect(normalizeAllowedPages(["stock", "nonsense", "frost", "finance-presentation"])).toEqual(["frost", "stock"]);
    expect(normalizeAllowedPages(["profitability", "finance-presentation"])).toEqual(["finance-presentation", "profitability"]);
  });
});

describe("landingPathFor", () => {
  it("lands on Executive Summary when the login has it", () => {
    expect(landingPathFor("VIEWER", ["executive-summary", "stock"], false)).toBe("/executive-summary");
    expect(landingPathFor("ADMIN", [], false)).toBe("/executive-summary");
  });

  it("lands a Sales Rep on their own My Sales when linked", () => {
    expect(landingPathFor("SALES_REP", ["sales"], true)).toBe("/my-sales");
  });

  it("otherwise lands on the first module the login can open", () => {
    expect(landingPathFor("STORES_MANAGER", ["stock", "dormant-stock", "order-360", "reports"], false)).toBe("/stock");
    expect(landingPathFor("SALES_REP", ["reps"], false)).toBe("/sales");
    expect(landingPathFor("SALES_REP", ["frost"], false)).toBe("/frost");
  });

  it("falls back to My Sales, then to Executive Summary's no-access message", () => {
    expect(landingPathFor("SALES_REP", [], true)).toBe("/my-sales");
    expect(landingPathFor("SALES_REP", [], false)).toBe("/executive-summary");
  });
});
