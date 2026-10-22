import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { addOutletEvents, buildFrequencyOutlets, buildFrequencySummary, cadenceFor, channelGroup, isoWeekOf, isoWeeksInYear, resolveFrequencyPeriod, type FrequencyReport } from "../lib/outletUniverse/frequency";
import { OUTLET_COLUMNS, columnLetter, frequencyCsv, frequencyWorkbook } from "../lib/outletUniverse/frequencyExport";

const NOW = new Date("2026-10-22T09:00:00Z");
const period = (query: string) => resolveFrequencyPeriod(new URLSearchParams(query), NOW);
const bought = (...months: number[]) => new Set(months);

describe("the extract's period", () => {
  it("resolves an ISO week from its Monday", () => {
    const p = period("kind=week&year=2026&week=43");
    expect(p.start.toISOString().slice(0, 10)).toBe("2026-10-19");
    expect(p.end.toISOString().slice(0, 10)).toBe("2026-10-26");
    expect(p.label).toBe("Week 43 2026 (19 Oct to 25 Oct)");
    expect(isoWeekOf(new Date("2026-10-22")).week).toBe(43);
    expect(isoWeeksInYear(2026)).toBe(53);
  });

  it("resolves a quarter, a month and a year, defaulting to the current one", () => {
    expect(period("kind=quarter&year=2026&quarter=2")).toMatchObject({ label: "Q2 2026", startedMonths: [3, 4, 5] });
    expect(period("kind=month&year=2026&month=9").start.toISOString().slice(0, 10)).toBe("2026-09-01");
    expect(period("kind=quarter").label).toBe("Q4 2026");
    expect(period("").label).toBe("2026");
    expect(period("kind=bogus&year=nonsense").label).toBe("2026");
  });

  it("only expects purchases in months that have started", () => {
    expect(period("kind=year&year=2026").startedMonths).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(period("kind=quarter&year=2026&quarter=4").startedMonths).toEqual([9]);
    expect(period("kind=year&year=2025").startedMonths).toHaveLength(12);
  });
});

describe("the best cadence an outlet kept up", () => {
  const year2025 = period("kind=year&year=2025");
  const q3 = period("kind=quarter&year=2026&quarter=3");

  it("is monthly only when every month of the period has a purchase", () => {
    expect(cadenceFor(bought(...Array.from({ length: 12 }, (_, i) => i)), year2025)).toBe("Once Per Month");
    expect(cadenceFor(bought(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10), year2025)).toBe("Once in 3 Months");
  });

  it("is quarterly when each quarter has one, half-yearly when each half does, else yearly", () => {
    expect(cadenceFor(bought(0, 3, 6, 9), year2025)).toBe("Once in 3 Months");
    expect(cadenceFor(bought(1, 7), year2025)).toBe("Once in 6 Months");
    expect(cadenceFor(bought(4), year2025)).toBe("Once per Year");
    expect(cadenceFor(bought(0, 1, 2), year2025)).toBe("Once per Year");
  });

  it("works inside a quarter, a month and a week", () => {
    expect(cadenceFor(bought(6, 7, 8), q3)).toBe("Once Per Month");
    expect(cadenceFor(bought(6, 8), q3)).toBe("Once in 3 Months");
    expect(cadenceFor(bought(8), period("kind=month&year=2026&month=9"))).toBe("Once Per Month");
    expect(cadenceFor(bought(9), period("kind=week&year=2026&week=43"))).toBe("Once Per Month");
  });

  it("is null when the outlet did not buy", () => {
    expect(cadenceFor(bought(), year2025)).toBeNull();
  });
});

describe("channel groups", () => {
  it("map the system's channels to the summary rows", () => {
    expect(["Retail", "wholesale", "Modern Trade", "On Trade", "Croma 10+2", "", null].map(channelGroup)).toEqual(["Retail", "Wholesale", "Modern Trade", "On Trade", "Others", "Others", "Others"]);
  });
});

// Three Pine outlets (one buys Mars and Suntory, one Mars only, one Suntory only) and one EABL outlet, over a 2025 year.
const universe = [
  { source: "PINE" as const, outletKey: "1", principal: "Mars-Nairobi", outletName: "Alpha", channel: "Retail", segment: "Kiosk", rawChannel: "Retail", rawSegment: "Kiosk", location: "Nairobi", region: "Nairobi", territory: "Roysambu", route: null, repName: "Rep A", teamLeader: "TL", sales: 100 },
  { source: "PINE" as const, outletKey: "1", principal: "Suntory-Nairobi", outletName: "Alpha", channel: "Retail", segment: "Kiosk", rawChannel: "Retail", rawSegment: "Kiosk", location: "Nairobi", region: "Nairobi", territory: "Roysambu", route: null, repName: "Rep A", teamLeader: "TL", sales: 40 },
  { source: "PINE" as const, outletKey: "2", principal: "Mars-Nairobi", outletName: "Beta", channel: "Wholesale", segment: "Wholesalers", rawChannel: "Wholesale", rawSegment: "Wholesalers", location: "Nairobi", region: "Eastern", territory: "Machakos", route: null, repName: "Rep B", teamLeader: "TL", sales: 80 },
  { source: "PINE" as const, outletKey: "3", principal: "Suntory-Nairobi", outletName: "Gamma", channel: "Retail", segment: "Shop", rawChannel: "Retail", rawSegment: "Shop", location: "Nairobi", region: "Nairobi", territory: "Kasarani", route: null, repName: "Rep C", teamLeader: "TL", sales: 30 },
  { source: "EABL" as const, outletKey: "E1", principal: "EABL-Nyeri", outletName: "Pub", channel: "On Trade", segment: "Bar", rawChannel: "On Trade", rawSegment: "Bar", location: "Nyeri", region: "Nyeri", territory: "Nyeri Town", route: null, repName: "Rep E", teamLeader: "TL", sales: 20 },
  { source: "PINE" as const, outletKey: "9", principal: "Mars-Nairobi", outletName: "Never bought", channel: "Retail", segment: "Kiosk", rawChannel: null, rawSegment: null, location: "Nairobi", region: "Nairobi", territory: "X", route: null, repName: null, teamLeader: null, sales: 0 },
];
const ev = (months: Record<number, [number, number, number]>) => ({
  months: new Map(Object.entries(months).map(([m, [all, conf, other]]) => [Number(m), { all, conf, other }])),
  first: "2025-01-05",
  last: "2025-12-20",
});
const monthly = Object.fromEntries(Array.from({ length: 12 }, (_, m) => [m, [2, 1, 1] as [number, number, number]]));
const events = new Map([
  ["PINE\u00001", ev(monthly)], // Mars and Suntory every month: monthly overall, monthly excluding Mars
  ["PINE\u00002", ev({ 0: [1, 1, 0], 7: [1, 1, 0] })], // Mars only: every half-year
  ["PINE\u00003", ev({ 4: [1, 0, 1] })], // Suntory only, once
  ["EABL\u0000E1", ev({ 1: [1, 0, 1], 4: [1, 0, 1], 7: [1, 0, 1], 10: [1, 0, 1] })], // quarterly
]);
const y2025 = period("kind=year&year=2025");
const outlets = buildFrequencyOutlets(universe, events, y2025);
const summary = buildFrequencySummary(outlets);

describe("the outlet rows and the summary", () => {
  it("lists only outlets that bought, once each, with their principals and flags", () => {
    expect(outlets.map((o) => o.outletName).sort()).toEqual(["Alpha", "Beta", "Gamma", "Pub"]);
    const alpha = outlets.find((o) => o.outletName === "Alpha")!;
    expect(alpha).toMatchObject({ principals: "Mars-Nairobi; Suntory-Nairobi", boughtConfectionery: true, boughtOther: true, purchaseDays: 24, cadenceAll: "Once Per Month", cadenceOther: "Once Per Month" });
    expect(outlets.find((o) => o.outletName === "Beta")).toMatchObject({ boughtOther: false, cadenceOther: null, cadenceAll: "Once in 6 Months" });
  });

  it("counts every outlet once in the cadence table, including confectioneries", () => {
    const t = summary.including;
    expect(t.total.total).toBe(4);
    expect(t.total.counts).toEqual({ "Once per Year": 1, "Once in 6 Months": 1, "Once in 3 Months": 1, "Once Per Month": 1 });
    expect(t.rows.find((r) => r.label === "Retail")).toMatchObject({ total: 2, confectionery: 1 });
    expect(t.rows.find((r) => r.label === "Wholesale")).toMatchObject({ total: 1, confectionery: 1 });
    expect(t.total.confectionery).toBe(2);
  });

  it("leaves outlets that bought only confectionery out of the excluding tables", () => {
    expect(summary.excluding.total.total).toBe(3);
    expect(summary.excluding.rows.find((r) => r.label === "Wholesale")?.total).toBe(0);
    expect(summary.byRegion.rows.map((r) => r.label)).toEqual(["Nairobi", "Nyeri"]);
    expect(summary.byRegion.total.total).toBe(3);
  });
});

describe("the files", () => {
  const report: FrequencyReport = { period: y2025, outlets, summary, generatedAt: "2025-12-31T00:00:00Z" };

  it("writes the raw rows as CSV with one header and a neutralised formula", () => {
    const csv = frequencyCsv([{ ...outlets[0], outletName: "=SUM(1)" }, ...outlets.slice(1)]);
    const lines = csv.split("\r\n");
    expect(lines).toHaveLength(outlets.length + 1);
    expect(lines[0].split(",")[0]).toBe("Source");
    expect(lines[1]).toContain("'=SUM(1)");
  });

  it("writes a workbook whose summary counts the outlet data by formula", () => {
    const wb = XLSX.read(frequencyWorkbook(report, ["principal brand = Mars"]), { type: "buffer" });
    expect(wb.SheetNames).toEqual(["Summary", "Outlet Data", "Notes"]);
    const summarySheet = wb.Sheets["Summary"];
    // Row 6 is the first channel row of the first table (title row 4, header row 5), like the example.
    const channelCol = columnLetter(OUTLET_COLUMNS.findIndex((c) => c.header === "Channel (Group)"));
    const cadenceCol = columnLetter(OUTLET_COLUMNS.findIndex((c) => c.header === "Cadence"));
    expect(summarySheet["B6"].v).toBe("Retail");
    expect(summarySheet["C6"].f).toBe(`COUNTIFS('Outlet Data'!$${channelCol}:$${channelCol},$B6,'Outlet Data'!$${cadenceCol}:$${cadenceCol},C$5)`);
    expect(summarySheet["F6"].v).toBe(1);
    expect(summarySheet["C5"].v).toBe("Once per Year");
    expect(summarySheet["G5"].v).toBe("Confectioneries");
    expect(summarySheet["C11"].f).toBe("SUM(C6:C10)");
    const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Outlet Data"]);
    expect(data).toHaveLength(4);
    expect(data[0]["Cadence"]).toBeDefined();
  });
});

describe("reading the purchase queries", () => {
  it("turns the calendar months the queries return (1 to 12) into month indexes, so a buyer in every month of Q3 is monthly", () => {
    const q3 = period("kind=quarter&year=2026&quarter=3");
    const map = new Map();
    addOutletEvents(map, "PINE", { outletKey: "1", months: [7, 8, 9], alls: [4, 3, 5], confs: [0, 0, 0], others: [4, 3, 5], first: "2026-07-01", last: "2026-09-28" });
    const row = { source: "PINE" as const, outletKey: "1", principal: "Suntory-Nairobi", outletName: "A", channel: "Retail", segment: "Kiosk", rawChannel: null, rawSegment: null, location: "Nairobi", region: "Nairobi", territory: "T", route: null, repName: null, teamLeader: null, sales: 1 };
    const [outlet] = buildFrequencyOutlets([row], map, q3);
    expect(outlet.cadenceAll).toBe("Once Per Month");
    expect(outlet.daysByMonth.slice(6, 9)).toEqual([4, 3, 5]);
    expect(outlet.daysByMonth[0]).toBe(0);
  });
});
