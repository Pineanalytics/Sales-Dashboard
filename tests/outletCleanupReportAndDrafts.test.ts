import { describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";

// data.ts reaches the auth stack through access.ts; the pure parts are all this test needs.
vi.mock("../lib/db", () => ({ prisma: {} }));
vi.mock("../lib/outletCleanup/access", () => ({ inActorScope: () => true }));
vi.mock("../lib/outletCleanup/routingData", () => ({ loadRouting: async () => ({ routing: {}, routeLocations: [] }) }));

import { parseQueueFilters } from "../lib/outletCleanup/data";
import { REPORT_COLUMNS, reportCsv, reportFileStem, reportWorkbook, type ReportRow } from "../lib/outletCleanup/reportExport";
import { REVIEW_STATE_LABELS } from "../lib/outletCleanup/types";
import { cleanDraftInput } from "../lib/outletCleanup/validate";

const row = (over: Partial<ReportRow> = {}): ReportRow => ({
  source: "PINE",
  outletKey: "1001",
  outletName: "Mama Njeri Shop",
  principals: "Suntory, Bidco",
  region: "Nairobi",
  territory: "Kayole",
  channel: "Retail",
  customerType: "Kiosk",
  contactName: "Njeri",
  contactPhone: "+254712345678",
  teamLeaders: "Eve Theuri",
  reps: "Jane Doe",
  latitude: -1.28,
  longitude: 36.82,
  hasGeo: true,
  shopSize: 1,
  lastPurchaseDate: "2026-10-20",
  activity: "ACTIVE",
  daysSince: 10,
  state: "REVIEWED",
  hasDraft: false,
  reviewedBy: "eve.theuri@pinefrost.co.ke",
  reviewedAt: "2026-10-25",
  verifiedFields: "Territory, Channel",
  repDecisions: "Suntory: Jane Doe, route Kayole-Embakasi, Mon/Thu",
  adminNote: "",
  ...over,
});

describe("outlet cleanup report extract", () => {
  it("writes a header row and one line per outlet, with every column filled from the row", () => {
    const lines = reportCsv([row(), row({ outletKey: "1002", state: "UNREVIEWED", hasDraft: true })]).split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[0].split(",")).toHaveLength(REPORT_COLUMNS.length);
    expect(lines[1]).toContain("Mama Njeri Shop");
    expect(lines[1]).toContain(REVIEW_STATE_LABELS.REVIEWED);
    expect(lines[2]).toContain(REVIEW_STATE_LABELS.UNREVIEWED);
    expect(lines[2]).toContain(",Yes,"); // Draft Saved
  });

  it("quotes cells with commas or quotes and neutralises formula starters", () => {
    const csv = reportCsv([row({ outletName: '=HYPERLINK("x")', principals: "Suntory, Bidco" })]);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain('"Suntory, Bidco"');
  });

  it("leaves GPS blank when the outlet has no point", () => {
    const [, line] = reportCsv([row({ hasGeo: false, latitude: null, longitude: null, principals: "Suntory", repDecisions: "" })]).split("\r\n");
    const cells = line.split(",");
    const at = REPORT_COLUMNS.findIndex((c) => c.header === "Latitude");
    expect(cells[at]).toBe("");
    expect(cells[at + 1]).toBe("");
  });

  it("builds a workbook with the outlets and an About sheet that lists the filters", () => {
    const buffer = reportWorkbook([row(), row({ outletKey: "1002" })], { generatedAt: new Date("2026-10-30T08:15:00Z"), generatedBy: "eve.theuri@pinefrost.co.ke", filters: ["Rep: Jane Doe", "Principal: Suntory"] });
    const book = XLSX.read(buffer, { type: "buffer" });
    expect(book.SheetNames).toEqual(["Outlets", "About"]);
    const outlets = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets.Outlets);
    expect(outlets).toHaveLength(2);
    expect(outlets[0].Outlet).toBe("Mama Njeri Shop");
    const about = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets.About, { header: 1 }).flat().join("|");
    expect(about).toContain("Rep: Jane Doe");
    expect(about).toContain("Principal: Suntory");
  });

  it("names the file by date", () => {
    expect(reportFileStem(new Date("2026-10-30T10:00:00Z"))).toBe("outlet-cleanup-report-2026-10-30");
  });

  it("accepts the drafts state in the list filters", () => {
    expect(parseQueueFilters(new URLSearchParams("state=drafts")).state).toBe("drafts");
    expect(parseQueueFilters(new URLSearchParams("state=nonsense")).state).toBe("todo");
  });
});

describe("cleanDraftInput", () => {
  const editable = { identification: ["region", "territory", "channel", "customerType", "contactName", "contactPhone"] as const, principals: ["Suntory", "Bidco"] };

  it("keeps typed identification values as they are, without checking them against the lists", () => {
    const clean = cleanDraftInput({ set: { territory: "  Kayole  ", contactPhone: "07", bogus: "x" } }, editable);
    expect(clean.identification).toEqual({ territory: "Kayole", contactPhone: "07" });
  });

  it("drops fields that are not editable (locked)", () => {
    const clean = cleanDraftInput({ set: { territory: "Kayole", channel: "Retail" } }, { ...editable, identification: ["channel"] });
    expect(clean.identification).toEqual({ channel: "Retail" });
  });

  it("keeps rep rows only for the person's principals, with weekdays in week order", () => {
    const clean = cleanDraftInput({ reps: [{ principal: "suntory", repCode: "R1", routeName: "Kayole-Embakasi", visitDays: ["thu", "Mon"] }, { principal: "Unilever", routeName: "X" }, { principal: "Bidco" }] }, editable);
    expect(clean.reps).toEqual([{ principal: "Suntory", repCode: "R1", routeName: "Kayole-Embakasi", visitDays: ["Mon", "Thu"] }]);
  });

  it("returns nothing for an empty draft, and ignores a non-weekday list", () => {
    expect(cleanDraftInput({ set: {}, reps: [] }, editable)).toEqual({ identification: {}, reps: [] });
    expect(cleanDraftInput({ reps: [{ principal: "Bidco", routeName: "R", visitDays: ["Funday"] }] }, editable).reps).toEqual([{ principal: "Bidco", routeName: "R", visitDays: [] }]);
  });
});
