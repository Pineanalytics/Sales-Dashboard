import * as XLSX from "xlsx";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { FrequencyOutlet } from "../lib/outletUniverse/frequency";
import { buildReckittOutlets, buildReckittSummary, reckittMonths, reckittSelection, reckittTenure, reckittWindow, restructureSegment, rowLabels, type ReckittReport } from "../lib/outletUniverse/reckitt";
import { reckittColumns, reckittCsv, reckittFileStem, reckittWorkbook } from "../lib/outletUniverse/reckittExport";
import { columnLetter } from "../lib/outletUniverse/frequencyExport";

const NOW = new Date("2026-10-28T09:00:00Z");

/** Purchase days by calendar month index (0 = January) from a list of [month index, days]. */
const days = (...pairs: [number, number][]) => {
  const out = Array.from({ length: 12 }, () => 0);
  for (const [m, d] of pairs) out[m] = d;
  return out;
};

function shop(overrides: Partial<FrequencyOutlet> & { daysByMonth: number[] }): FrequencyOutlet {
  return {
    source: "Pine",
    outletKey: "1",
    outletName: "Shop",
    shopId: "Pine:1",
    outletsMerged: 1,
    systems: "Pine",
    mergedOutlets: "",
    channel: "Others",
    segment: "Retailers",
    sourceSegment: "Retailers",
    tier: "1,001 - 5,000",
    regionGroup: "Nairobi",
    region: "Nairobi",
    territory: "Westlands",
    classification: "Direct",
    absolutePrincipal: "Mars-Nairobi",
    principals: "Mars-Nairobi",
    teamLeader: "Eve",
    boughtConfectionery: true,
    boughtOther: false,
    averageSales: 4000,
    combinedAverage: 4000,
    purchaseDays: 10,
    purchaseDaysConfectionery: 10,
    purchaseDaysOther: 0,
    purchaseDaysPerMonth: 1.7,
    monthsBought: 3,
    firstPurchase: "2026-05-02",
    lastPurchase: "2026-10-20",
    cadenceAll: "Once Per Month",
    cadenceOther: null,
    periodsBought90: 3,
    consistency90: "Consistent",
    periodsBought180: 6,
    consistency180: "Consistent",
    buyingTenure: "3 to 6 months",
    ...overrides,
  };
}

describe("Reckitt window", () => {
  it("is the six calendar months ending with the current one", () => {
    const w = reckittWindow(NOW);
    expect(w.label).toBe("May 2026 to Oct 2026");
    expect(w.startedMonths).toEqual([4, 5, 6, 7, 8, 9]);
    expect(w.start.toISOString().slice(0, 10)).toBe("2026-05-01");
    expect(w.end.toISOString().slice(0, 10)).toBe("2026-11-01");
  });

  it("reaches back across the year end", () => {
    const w = reckittWindow(new Date("2027-01-15T09:00:00Z"));
    expect(w.label).toBe("Aug 2026 to Jan 2027");
    expect(w.startedMonths).toEqual([7, 8, 9, 10, 11, 0]);
    expect(reckittMonths(w).map((m) => m.label)).toEqual(["Aug 2026", "Sep 2026", "Oct 2026", "Nov 2026", "Dec 2026", "Jan 2027"]);
  });
});

describe("Reckitt buying tenure", () => {
  const w = reckittWindow(NOW);
  it("is Once Per Month when the shop bought in every month of the window", () => {
    expect(reckittTenure(days([4, 1], [5, 2], [6, 1], [7, 1], [8, 3], [9, 1]), w)).toBe("Once Per Month");
  });
  it("is Once in 3 Months when it bought in the last three months but missed one of the six", () => {
    expect(reckittTenure(days([4, 1], [8, 1]), w)).toBe("Once in 3 Months");
    expect(reckittTenure(days([9, 1]), w)).toBe("Once in 3 Months");
    expect(reckittTenure(days([7, 2], [8, 2], [9, 2]), w)).toBe("Once in 3 Months");
  });
  it("is Once in 6 Months when it bought in the window but not in the last three months", () => {
    expect(reckittTenure(days([4, 1]), w)).toBe("Once in 6 Months");
    expect(reckittTenure(days([4, 1], [5, 1], [6, 1]), w)).toBe("Once in 6 Months");
  });
  it("is null when it did not buy in the window; purchases in months outside it do not count", () => {
    expect(reckittTenure(days(), w)).toBeNull();
    expect(reckittTenure(days([0, 5], [1, 5], [2, 5], [3, 5]), w)).toBeNull();
  });
  it("works across the year end", () => {
    const jan = reckittWindow(new Date("2027-01-15T09:00:00Z"));
    expect(reckittTenure(days([7, 1], [8, 1], [9, 1], [10, 1], [11, 1], [0, 1]), jan)).toBe("Once Per Month");
    expect(reckittTenure(days([11, 1]), jan)).toBe("Once in 3 Months");
    expect(reckittTenure(days([7, 1]), jan)).toBe("Once in 6 Months");
  });
});

describe("Reckitt selection", () => {
  it("selects a retail segment above KSh 3,000 a purchase and a wholesaler above KSh 20,000", () => {
    expect(reckittSelection("Retailers", 3001).selected).toBe(true);
    expect(reckittSelection("Retailers", 3000).selected).toBe(false);
    expect(reckittSelection("Wholesalers", 20001).selected).toBe(true);
    expect(reckittSelection("Wholesalers", 15000).selected).toBe(false);
    expect(reckittSelection("Pharmacies", 5000).selected).toBe(true);
  });
  it("leaves out segments Reckitt cannot stock, and shops with no average", () => {
    expect(reckittSelection("Horeca", 90000)).toEqual({ selected: false, basis: "Segment cannot stock the Reckitt portfolio" });
    expect(reckittSelection("Wines & Spirits", 90000).selected).toBe(false);
    expect(reckittSelection("Retailers", null)).toEqual({ selected: false, basis: "No average spend on record" });
  });
  it("matches segments whatever their case", () => {
    expect(reckittSelection(" retailers ", 4000).selected).toBe(true);
  });
});

describe("Reckitt segment restructure", () => {
  it("groups the source segment names as the template does", () => {
    for (const [source, group] of [["Minimart", "Wholesalers"], ["Mini Mart/t3 Store", "Wholesalers"], ["Distributor", "Wholesalers"], ["Kiosk", "Retailers"], ["Shop", "Retailers"], ["Small Duka", "Retailers"], ["Large Duka", "Retailers"], ["Supermarkets", "LMT"], ["Large Modern Trade", "LMT"], ["Bar", "Horeca"], ["Hotel", "Horeca"], ["Lodging", "Horeca"], ["Specialist Store", "Wines & Spirits"], ["Pharmacies", "Pharmacies"], ["Baby Shop", "Baby Shop"]] as const) {
      expect(restructureSegment(source)).toBe(group);
    }
  });
  it("matches whatever the case and spacing, and keeps a segment in no group as it is", () => {
    expect(restructureSegment("  minimart ")).toBe("Wholesalers");
    expect(restructureSegment("Spaza")).toBe("Spaza");
  });
});

describe("Reckitt rows and summary", () => {
  const w = reckittWindow(NOW);
  const shops = [
    shop({ outletKey: "1", daysByMonth: days([4, 1], [5, 1], [6, 1], [7, 1], [8, 1], [9, 1]) }),
    shop({ outletKey: "2", daysByMonth: days([9, 2]), classification: "Indirect", lastPurchase: "2026-10-25" }),
    shop({ outletKey: "3", daysByMonth: days([4, 2]), segment: "Minimart", sourceSegment: "Minimart", combinedAverage: 25000, lastPurchase: "2026-05-10", classification: "Indirect" }),
    shop({ outletKey: "4", daysByMonth: days([1, 3]) }),
    shop({ outletKey: "5", daysByMonth: days([9, 1]), segment: "Horeca", sourceSegment: "Bar", combinedAverage: 50000 }),
  ];
  const rows = buildReckittOutlets(shops, w, NOW);

  it("drops shops that did not buy in the window and tags the rest", () => {
    expect(rows.map((r) => r.outletKey)).toEqual(["1", "2", "3", "5"]);
    expect(rows.map((r) => r.tenure)).toEqual(["Once Per Month", "Once in 3 Months", "Once in 6 Months", "Once in 3 Months"]);
  });

  it("marks the restructured segment, the active shops and the selection", () => {
    expect(rows.map((r) => r.segment)).toEqual(["Retailers", "Retailers", "Wholesalers", "Horeca"]);
    expect(rows.map((r) => r.segmentRestructured)).toEqual([false, false, true, true]);
    expect(rows.map((r) => r.active)).toEqual([true, true, false, true]);
    expect(rows.map((r) => r.selected)).toEqual([true, true, true, false]);
    expect(rows[0].windowDays).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it("counts every shop once, so the tenures add up to the total and Direct plus Indirect to the whole", () => {
    const s = buildReckittSummary(rows);
    const e = s.entire;
    expect(e.all.total.total).toBe(4);
    expect(e.all.total.counts).toEqual({ "Once in 6 Months": 1, "Once in 3 Months": 2, "Once Per Month": 1 });
    expect(e.directSegment.total.total + e.indirectSegment.total.total).toBe(4);
    expect(e.directRegion.total.total + e.indirectRegion.total.total).toBe(4);
    expect(s.selected.all.total.total).toBe(3);
    expect(s.recommended.reduce((sum, r) => sum + r.total, 0)).toBe(3);
    expect(s.recommended.find((r) => r.label === "Wholesalers")).toEqual({ label: "Wholesalers", direct: 0, indirect: 1, total: 1 });
  });

  it("lists a segment found in the data but not in the fixed rows", () => {
    expect(rowLabels(["Retailers", "Wholesalers"], ["Retailers", "Kiosk", "kiosk"])).toEqual(["Retailers", "Wholesalers", "Kiosk"]);
  });
});

describe("Reckitt workbook", () => {
  const w = reckittWindow(NOW);
  const rows = buildReckittOutlets(
    [
      shop({ outletKey: "1", outletName: "=EVIL()", daysByMonth: days([4, 1], [5, 1], [6, 1], [7, 1], [8, 1], [9, 1]) }),
      shop({ outletKey: "2", daysByMonth: days([9, 2]), classification: "Indirect" }),
      shop({ outletKey: "3", daysByMonth: days([4, 2]), segment: "Minimart", sourceSegment: "Minimart", combinedAverage: 25000 }),
    ],
    w,
    NOW
  );
  const report: ReckittReport = { window: w, months: reckittMonths(w), outlets: rows, systemOutlets: 4, duplicatesMerged: 1, generatedAt: NOW.toISOString() };
  const workbook = XLSX.read(reckittWorkbook(report), { type: "buffer" });

  it("has the summary, the raw rows and the definitions", () => {
    expect(workbook.SheetNames).toEqual(["Summary", "Raw Data", "Definition Of Terms"]);
    const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets["Raw Data"]);
    expect(raw).toHaveLength(3);
    expect(raw.map((r) => r["Buying Tenure"])).toEqual(["Once Per Month", "Once in 3 Months", "Once in 6 Months"]);
    expect(raw.map((r) => r["Direct vs Indirect"])).toEqual(["Direct", "Indirect", "Direct"]);
    expect(raw.map((r) => r["Reckitt Selected"])).toEqual(["Yes", "Yes", "Yes"]);
    expect(Object.keys(raw[0])).toContain("May 2026 Purchase Days");
    expect(Object.keys(raw[0])).toContain("Oct 2026 Purchase Days");
  });

  it("has a summary of COUNTIFS formulas over the raw rows with the tenure columns in order", () => {
    const sheet = workbook.Sheets["Summary"];
    const text = XLSX.utils.sheet_to_csv(sheet);
    expect(text).toContain("Once in 6 Months,Once in 3 Months,Once Per Month,Total Distinct Coverage");
    const formulas = Object.values(sheet).filter((c): c is XLSX.CellObject => typeof c === "object" && c !== null && "f" in c).map((c) => String(c.f));
    expect(formulas.some((f) => f.startsWith("COUNTIFS('Raw Data'!"))).toBe(true);
    expect(formulas.some((f) => f.includes('"Direct"'))).toBe(true);
    expect(formulas.some((f) => f.includes('"Yes"'))).toBe(true);
  });

  it("highlights the Segment / Type column yellow, header and cells, and nothing else in the sheet", () => {
    const buffer = reckittWorkbook(report);
    const files = unzipSync(new Uint8Array(buffer));
    expect(strFromU8(files["xl/styles.xml"])).toContain("FFFFFF00");
    const sheet = strFromU8(files["xl/worksheets/sheet2.xml"]);
    const letter = columnLetter(reckittColumns([]).findIndex((c) => c.header === "Segment / Type"));
    expect([...sheet.matchAll(new RegExp(`<c r="${letter}\\d+" s="1"`, "g"))]).toHaveLength(4);
    expect([...sheet.matchAll(/ s="1"/g)]).toHaveLength(4);
  });

  it("neutralises an outlet name that looks like a formula in the CSV and names the file after the last month", () => {
    expect(reckittCsv(report)).toContain("'=EVIL()");
    expect(reckittFileStem(report)).toBe("reckitt-universe-2026-10");
  });
});
