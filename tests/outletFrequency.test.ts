import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import {
  addOutletEvents,
  buildFrequencyOutlets,
  buildFrequencySummary,
  cadenceFor,
  classificationOf,
  coverageChannel,
  coverageRegion,
  isoWeekOf,
  isoWeeksInYear,
  resolveFrequencyPeriod,
  servedByKeyAccountRep,
  type FrequencyReport,
  type OutletEvents,
} from "../lib/outletUniverse/frequency";
import { OUTLET_COLUMNS, columnLetter, frequencyCsv, frequencyWorkbook } from "../lib/outletUniverse/frequencyExport";
import type { OutletListRow } from "../lib/outletUniverse/query";
import { buildNameProfiles } from "../lib/outletUniverse/tiering";

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

describe("channel, region and Direct / Indirect", () => {
  it("map a tiered segment to the summary channel, with key account reps first", () => {
    const channels = ["Wholesalers", "Distributor", "Minimart", "Mini Mart/T3 Store", "Supermarkets", "Large Modern Trade", "Hyper", "Institutions", "Retailers", "Pharmacies", "Horeca", "Kiosk", "Unspecified"].map((s) => coverageChannel(s, false));
    expect(channels).toEqual(["Wholesalers", "Wholesalers", "Minimart", "Minimart", "LMT", "LMT", "LMT", "Institutions", "Others", "Others", "Others", "Others", "Others"]);
    expect(coverageChannel("Wholesalers", true)).toBe("Key Accounts");
    expect(coverageChannel("Retailers", true)).toBe("Key Accounts");
  });

  it("puts Central, Nyeri and Nyahururu in Mountain and falls back to the branch for places and placeholders", () => {
    expect(coverageRegion("Nairobi", "Nairobi")).toBe("Nairobi");
    expect(coverageRegion("Eastern", "Nairobi")).toBe("Eastern");
    expect(["Central", "Nyeri", "Nyahururu"].map((r) => coverageRegion(r, "Nairobi"))).toEqual(["Mountain", "Mountain", "Mountain"]);
    expect(coverageRegion("Unspecified", "Nairobi")).toBe("Nairobi"); // Pine outlets with no region
    expect(coverageRegion("1Tana River", "Nairobi")).toBe("Nairobi"); // a place, not a region
    expect(coverageRegion("General", "Nyeri")).toBe("Mountain"); // EABL General, served from Nyeri
    expect(coverageRegion("Isiolo", "Elsewhere")).toBe("Others");
  });

  it("calls Primary Sales (and Primary + Secondary) Direct and Secondary Sales Indirect, by the role of the Absolute Principal", () => {
    expect(["Primary Sales", "Primary + Secondary", "Secondary Sales"].map(classificationOf)).toEqual(["Direct", "Direct", "Indirect"]);
  });

  it("recognises an outlet served by a key account rep, by name or among its principals' reps", () => {
    const keyReps = new Set(["clarrine wahome"]);
    expect(servedByKeyAccountRep({ repName: "Clarrine Wahome", repsByPrincipal: null }, keyReps)).toBe(true);
    expect(servedByKeyAccountRep({ repName: "Other Rep", repsByPrincipal: "Suntory-Nairobi: Other Rep; Mars-Nairobi: Clarrine Wahome" }, keyReps)).toBe(true);
    expect(servedByKeyAccountRep({ repName: "Other Rep", repsByPrincipal: "Mars-Nairobi: Someone Else" }, keyReps)).toBe(false);
    expect(servedByKeyAccountRep({ repName: "Clarrine Wahome", repsByPrincipal: null }, new Set())).toBe(false);
  });
});

function outlet(overrides: Partial<OutletListRow>): OutletListRow {
  return {
    source: "PINE", outletKey: "1", outletName: "Alpha", principals: "Mars-Nairobi, Suntory-Nairobi", salesRole: "Primary Sales", channel: "Wholesale", segment: "Wholesalers",
    location: "Nairobi", region: "Central", territory: "Kiambu", route: null, repName: "Rep A", repCode: null, teamLeader: "TL", repStatus: null, repRegion: null, repSubRegion: null,
    teamLeadersByPrincipal: null, plannedRep: null, matchId: null, matchConfidence: null, matchedSystems: null, latitude: null, longitude: null, lastPurchaseDate: "2026-10-01",
    sales: 600_000, transactions: 12, active: true, firstPurchaseDate: "2026-01-05", periodsBought90: 3, periodsBought180: 6, principalCount: 2, dominantPrincipal: "Mars-Nairobi",
    dominantShare: 0.8, sharedPrincipals: null, repCount: 1, repsByPrincipal: "Mars-Nairobi: Rep A",
    ...overrides,
  };
}

const ev = (months: Record<number, [number, number, number]>): OutletEvents => ({
  months: new Map(Object.entries(months).map(([m, [all, conf, other]]) => [Number(m), { all, conf, other }])),
  first: "2025-01-05",
  last: "2025-12-20",
});
const monthly = Object.fromEntries(Array.from({ length: 12 }, (_, m) => [m, [2, 1, 1] as [number, number, number]]));

const rows = [
  outlet({ outletKey: "1", outletName: "Alpha" }), // wholesaler, Primary, every month, Mars + Suntory
  outlet({ outletKey: "2", outletName: "Beta", salesRole: "Primary + Secondary", segment: "Unspecified", channel: "Retail", region: "Nairobi", sales: 12_000, transactions: 12, dominantPrincipal: "Suntory-Nairobi" }), // unspecified segment, Secondary, Mars only
  outlet({ outletKey: "3", outletName: "Gamma", repName: "Clarrine Wahome", region: "Eastern", segment: "Retailers", channel: "Retail", sales: 900_000, transactions: 12 }), // key account
  outlet({ outletKey: "4", outletName: "Never bought", region: "Nairobi" }),
];
const events = new Map<string, OutletEvents>([
  ["PINE\u00001", ev(monthly)],
  ["PINE\u00002", ev({ 0: [1, 1, 0], 7: [1, 1, 0] })],
  ["PINE\u00003", ev({ 4: [1, 0, 1] })],
]);
const y2025 = period("kind=year&year=2025");
// How each principal reaches the outlet: Beta buys Suntory (dominant) through Secondary Sales although its Mars row is Primary.
const roles = new Map([
  ["PINE 1 Mars-Nairobi", "Primary Sales"],
  ["PINE 2 Suntory-Nairobi", "Secondary Sales"],
  ["PINE 2 Mars-Nairobi", "Primary Sales"],
  ["PINE 3 Mars-Nairobi", "Primary Sales"],
]);
const built = buildFrequencyOutlets(rows, buildNameProfiles(rows.map((r) => ({ outletName: r.outletName, channel: r.channel, segment: r.segment, sales: r.sales, transactions: r.transactions, active: r.active }))), events, y2025, new Set(["clarrine wahome"]), roles, NOW);
const byName = Object.fromEntries(built.map((o) => [o.outletName, o]));

describe("the outlet rows", () => {
  it("lists only outlets that bought, one row each", () => {
    expect(built.map((o) => o.outletName).sort()).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it("carries the tiering of the Active Outlets extract: tiered segment, average sales, combined average and tier", () => {
    expect(byName["Alpha"]).toMatchObject({ segment: "Wholesalers", averageSales: 50_000, combinedAverage: 50_000, tier: "20,001 - 50,000" });
    expect(byName["Beta"]).toMatchObject({ segment: "Retailers", sourceSegment: "Unspecified", averageSales: 1_000, tier: "501 - 1,000" }); // Unspecified becomes Retailers
  });

  it("classifies, groups and names the principal", () => {
    expect(byName["Alpha"]).toMatchObject({ channel: "Wholesalers", classification: "Direct", absolutePrincipal: "Mars-Nairobi", regionGroup: "Mountain", cadenceAll: "Once Per Month", cadenceOther: "Once Per Month" });
    expect(byName["Beta"]).toMatchObject({ channel: "Others", classification: "Indirect", regionGroup: "Nairobi", boughtOther: false, cadenceOther: null, cadenceAll: "Once in 6 Months" });
    expect(byName["Gamma"]).toMatchObject({ channel: "Key Accounts", regionGroup: "Eastern", cadenceAll: "Once per Year" });
  });

  it("adds the buying history and the purchase frequency", () => {
    expect(byName["Alpha"]).toMatchObject({ purchaseDays: 24, purchaseDaysPerMonth: 2, monthsBought: 12, periodsBought90: 3, consistency90: "Consistent", consistency180: "Consistent" });
  });

  it("reads the calendar months the queries return (1 to 12) as month indexes, so a buyer in every month of Q3 is monthly", () => {
    const q3 = period("kind=quarter&year=2026&quarter=3");
    const map = new Map<string, OutletEvents>();
    addOutletEvents(map, "PINE", { outletKey: "1", months: [7, 8, 9], alls: [4, 3, 5], confs: [0, 0, 0], others: [4, 3, 5], first: "2026-07-01", last: "2026-09-28" });
    const [o] = buildFrequencyOutlets([rows[0]], buildNameProfiles([]), map, q3, new Set(), new Map(), NOW);
    expect(o.cadenceAll).toBe("Once Per Month");
    expect(o.daysByMonth.slice(6, 9)).toEqual([4, 3, 5]);
    expect(o.daysByMonth[0]).toBe(0);
  });
});

describe("the summary", () => {
  const summary = buildFrequencySummary(built);

  it("counts every outlet once by channel and cadence", () => {
    expect(summary.all.total.total).toBe(3);
    expect(summary.all.rows.find((r) => r.label === "Wholesalers")?.counts["Once Per Month"]).toBe(1);
    expect(summary.all.rows.find((r) => r.label === "Key Accounts")?.counts["Once per Year"]).toBe(1);
    expect(summary.all.rows.find((r) => r.label === "DTR")?.total).toBe(0);
  });

  it("splits Direct and Indirect, by channel and by region", () => {
    expect(summary.directChannel.total.total).toBe(2);
    expect(summary.indirectChannel.total.total).toBe(1);
    expect(summary.indirectChannel.rows.find((r) => r.label === "Others")?.counts["Once in 6 Months"]).toBe(1);
    expect(summary.directRegion.rows.find((r) => r.label === "Mountain")?.total).toBe(1);
    expect(summary.directRegion.rows.find((r) => r.label === "Eastern")?.total).toBe(1);
    expect(summary.indirectRegion.rows.find((r) => r.label === "Nairobi")?.total).toBe(1);
    expect(summary.directRegion.total.total + summary.indirectRegion.total.total).toBe(3);
  });
});

describe("the files", () => {
  const report: FrequencyReport = { period: y2025, outlets: built, summary: buildFrequencySummary(built), generatedAt: "2025-12-31T00:00:00Z" };
  const letter = (name: string) => columnLetter(OUTLET_COLUMNS.findIndex((c) => c.header === name));

  it("writes the raw rows as CSV, one header and a neutralised formula", () => {
    const csv = frequencyCsv([{ ...built[0], outletName: "=SUM(1)" }, ...built.slice(1)]);
    const lines = csv.split("\r\n");
    expect(lines).toHaveLength(built.length + 1);
    expect(lines[0].split(",")).toHaveLength(OUTLET_COLUMNS.length);
    expect(lines[0]).toContain("Tier");
    expect(lines[0]).toContain("Absolute Principal");
    expect(lines[1]).toContain("'=SUM(1)");
  });

  it("writes a workbook laid out like the example, whose summary counts the Raw Data sheet by formula", () => {
    const wb = XLSX.read(frequencyWorkbook(report, ["principal brand = Mars"]), { type: "buffer" });
    expect(wb.SheetNames).toEqual(["Summary", "Raw Data", "Notes"]);
    const s = wb.Sheets["Summary"];
    const channel = `'Raw Data'!$${letter("Channel")}:$${letter("Channel")}`;
    const cadence = `'Raw Data'!$${letter("Cadence")}:$${letter("Cadence")}`;
    const classification = `'Raw Data'!$${letter("Classification")}:$${letter("Classification")}`;
    const region = `'Raw Data'!$${letter("Region")}:$${letter("Region")}`;
    // Table one: title C3, headers row 4, DTR in row 5, Total in row 12.
    expect(s["C3"].v).toBe("Total Coverage (Including Confectioneries)");
    expect(s["B5"].v).toBe("DTR");
    expect(s["C5"].f).toBe(`COUNTIFS(${channel},$B5,${cadence},C$4)`);
    expect(s["B12"].v).toBe("Total");
    expect(s["C12"].f).toBe("SUM(C5:C11)");
    // Direct (from B) and Indirect (from I) side by side, titles in row 15.
    expect(s["C15"].v).toBe("Total Coverage - Direct");
    expect(s["J15"].v).toBe("Total Coverage - Indirect");
    expect(s["C17"].f).toBe(`COUNTIFS(${channel},$B17,${cadence},C$16,${classification},"Direct")`);
    expect(s["J17"].f).toBe(`COUNTIFS(${channel},$I17,${cadence},J$16,${classification},"Indirect")`);
    // By region, titles in row 28.
    expect(s["B30"].v).toBe("Nairobi");
    expect(s["C30"].f).toBe(`COUNTIFS(${region},$B30,${cadence},C$29,${classification},"Direct")`);
    const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Raw Data"]);
    expect(data).toHaveLength(3);
    expect(data.find((r) => r["Outlet"] === "Alpha")).toMatchObject({ Channel: "Wholesalers", Classification: "Direct", Tier: "20,001 - 50,000", Region: "Mountain" });
  });
});
