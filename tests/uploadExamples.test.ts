import { describe, expect, it } from "vitest";
import { parseProductsWorkbook } from "@/lib/parseProducts";
import { parseTargetsWorkbook } from "@/lib/parseTargets";
import { parseRosterCsv } from "@/lib/rosterImport";
import { parseSalesLeadershipCsv } from "@/lib/salesLeadershipImport";
import { parseUpfieldOutletMaster } from "@/lib/upfieldOutletMaster";
import { ROSTER_EXPORT_HEADER, rosterExportRows, type RosterExportAssignment } from "@/lib/rosterExport";
import {
  exampleToCsv,
  exampleToXlsx,
  exampleValue,
  leadershipExample,
  productsExample,
  sampleByGroup,
  targetsExample,
  UPLOAD_FORMATS,
  UPLOAD_KINDS,
  upfieldOutletsExample,
  type ProductInput,
  type TargetInput,
  type UpfieldOutletInput,
} from "@/lib/uploadExamples";

const toArrayBuffer = (buffer: Buffer): ArrayBuffer => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;

function product(itemNo: string, principal: string, overrides: Partial<ProductInput> = {}): ProductInput {
  return { itemNo, itemDescription: `Item ${itemNo}`, series: "222", size: "24-Pack", packSize: 24, principal, costPrice: 100.5, classification: "General", ssuConversion: 1, ...overrides };
}

describe("sampleByGroup", () => {
  it("takes the first few from each of the biggest groups", () => {
    const items = ["a1", "a2", "a3", "b1", "b2", "c1"];
    expect(sampleByGroup(items, (item) => item[0], 2, 2)).toEqual(["a1", "a2", "b1", "b2"]);
    expect(sampleByGroup(items, (item) => item[0], 1, 5)).toEqual(["a1", "b1", "c1"]);
  });
});

describe("the format guides", () => {
  it("describe every upload, with a column list that matches its example", () => {
    expect(UPLOAD_KINDS.sort()).toEqual(["products", "roster", "sales-leadership", "targets", "upfield-outlets"]);
    for (const kind of UPLOAD_KINDS) {
      const format = UPLOAD_FORMATS[kind];
      expect(format.columns.length).toBeGreaterThan(0);
      expect(format.columns.some((column) => column.required)).toBe(true);
      expect(new Set(format.columns.map((column) => column.name)).size).toBe(format.columns.length);
    }
    expect(UPLOAD_FORMATS.roster.columns.map((column) => column.name)).toEqual([...ROSTER_EXPORT_HEADER]);
  });
});

describe("the products example", () => {
  it("picks two well-filled products from each of the biggest principals, in item order", () => {
    const products = [
      product("B2", "Beta"), product("B1", "Beta"), product("B3", "Beta"), product("A1", "Alpha"), product("A2", "Alpha"),
      product("G1", "Gamma", { series: null, size: null, packSize: null, costPrice: null, classification: null, ssuConversion: null }),
      product("G0", "Gamma"),
      product("Z1", ""),
    ];
    const example = productsExample(products);
    expect(example.columns).toEqual(["Item No.", "Item Description", "Series", "Size", "Pack Size", "Principal", "Cost Price", "Classification", "SSU Conversion"]);
    expect(example.rows.map((row) => row[0])).toEqual(["A1", "A2", "B1", "B2", "G0", "G1"]);
  });

  it("reads back through the real products parser", () => {
    const example = productsExample([product("UKL0515", "Unilever"), product("GDJ00173", "Godrej", { classification: "Hair, Skin & Body" })]);
    const rows = parseProductsWorkbook(toArrayBuffer(Buffer.from(exampleToCsv(example), "utf-8")));
    expect(rows.map((row) => [row.itemNo, row.principal])).toEqual([["GDJ00173", "Godrej"], ["UKL0515", "Unilever"]]);
    expect(rows[0]).toMatchObject({ packSize: 24, costPrice: 100.5, ssuConversion: 1, classification: "Hair, Skin & Body", size: "24-Pack" });
  });
});

describe("the targets example", () => {
  const targets: TargetInput[] = [
    { year: "2026", monthIndex: 10, principal: "Mars-Nairobi", mainPrincipal: "Mars", valueTarget: 5_000_000, volumeTarget: 1200, coverageTarget: 300, productivityTarget: 250 },
    { year: "2026", monthIndex: 10, principal: "Bic-Nairobi", mainPrincipal: "Bic", valueTarget: 800_000, volumeTarget: null, coverageTarget: 90, productivityTarget: 70 },
    { year: "2026", monthIndex: 10, principal: "Upfield-Nairobi", mainPrincipal: "Upfield", valueTarget: 2_000_000, volumeTarget: 500, coverageTarget: null, productivityTarget: null },
    { year: "2026", monthIndex: 11, principal: "Mars-Nairobi", mainPrincipal: "Mars", valueTarget: 1, volumeTarget: 1, coverageTarget: 1, productivityTarget: 1 },
    { year: "2025", monthIndex: 11, principal: "Old-Nairobi", mainPrincipal: "Old", valueTarget: 1, volumeTarget: 1, coverageTarget: 1, productivityTarget: 1 },
  ];

  it("uses the latest month that has at least three targets, ordered by principal, with Period as the first of the month", () => {
    const example = targetsExample(targets);
    expect(example.rows.map((row) => row[1])).toEqual(["Bic-Nairobi", "Mars-Nairobi", "Upfield-Nairobi"]);
    expect((example.rows[0][0] as Date).toISOString().slice(0, 10)).toBe("2026-11-01");
  });

  it("reads back through the real targets parser from a workbook", () => {
    const workbook = exampleToXlsx(targetsExample(targets), { sheetName: "Targets Per Principal" });
    const rows = parseTargetsWorkbook(toArrayBuffer(workbook));
    expect(rows.map((row) => `${row.principal}:${row.year}-${row.month}`)).toEqual(["Bic-Nairobi:2026-November", "Mars-Nairobi:2026-November", "Upfield-Nairobi:2026-November"]);
    expect(rows[0]).toMatchObject({ mainPrincipal: "Bic", valueTarget: 800_000, volumeTarget: null, coverageTarget: 90, productivityTarget: 70 });
    expect(rows[1]).toMatchObject({ valueTarget: 5_000_000, volumeTarget: 1200 });
  });

  it("gives an empty example when no month has three targets", () => {
    expect(targetsExample(targets.slice(3)).rows).toEqual([]);
  });
});

describe("the roster example", () => {
  const assignment = (overrides: Partial<RosterExportAssignment>): RosterExportAssignment => ({
    employeeCode: "1221",
    employeeName: "Florence Ouma",
    sapName: "Florence Ouma",
    channel: "GT",
    teamLeaderId: "tl1",
    principal: "EFL-Nairobi",
    contributionPct: 0.18,
    salesRole: "PRIMARY",
    absolutePrincipal: "EFL-Nairobi",
    workGroup: "TDR",
    region: "Nairobi",
    subRegion: "Nairobi Metro",
    costCenter: null,
    salesPoint: "General Trade",
    route: "Nairobi Metro",
    stockPoint: "KD",
    supervisorId: "s1",
    managerId: "m1",
    ...overrides,
  });
  const names = { teamLeaders: new Map([["tl1", "Eva Gachoki"]]), supervisors: new Map([["s1", "Eva"]]), managers: new Map([["m1", "Mburu Kinyanjui"]]) };

  it("writes each assignment in the 18-column upload order, the contribution as a percentage", () => {
    const [row] = rosterExportRows([assignment({})], names);
    expect(row).toHaveLength(ROSTER_EXPORT_HEADER.length);
    expect(row.slice(0, 8)).toEqual(["1221", "Florence Ouma", "Florence Ouma", "GT", "Eva Gachoki", "EFL-Nairobi", "18.00%", "Primary"]);
    expect(row.slice(-2)).toEqual(["Eva", "Mburu Kinyanjui"]);
    expect(rosterExportRows([assignment({ contributionPct: null, salesRole: "SECONDARY", supervisorId: null, managerId: null })], names)[0].slice(6)).toEqual(["", "Secondary", "EFL-Nairobi", "TDR", "Nairobi", "Nairobi Metro", "", "General Trade", "Nairobi Metro", "KD", "", ""]);
  });

  it("reads back through the real roster parser as the 18-column shape", () => {
    const rows = rosterExportRows([assignment({}), assignment({ employeeCode: "1112", employeeName: "MaryAnne Mudemb", sapName: "MaryAnne Mudemb", contributionPct: null })], names);
    const csv = exampleToCsv({ columns: [...ROSTER_EXPORT_HEADER], rows });
    const parsed = parseRosterCsv(Buffer.from(csv, "utf-8"));
    expect(parsed.format).toBe("V18");
    expect(parsed.rows.map((row) => [row.employeeCode, row.teamLeaderName, row.principal, row.salesRole])).toEqual([["1221", "Eva Gachoki", "EFL-Nairobi", "PRIMARY"], ["1112", "Eva Gachoki", "EFL-Nairobi", "PRIMARY"]]);
    expect(parsed.rows[0]).toMatchObject({ contributionPct: 0.18, supervisorName: "Eva", managerName: "Mburu Kinyanjui", stockPoint: "KD" });
  });
});

describe("the sales leadership example", () => {
  const input = [
    { principal: "Mars-Nairobi", supervisor: "Lucy", supervisorEmail: "lucy@pinefrost.co.ke", teamLeader: "Lucy", teamLeaderEmail: null, headOfSales: "Mburu Kinyanjui" },
    { principal: "Bic-Nairobi", supervisor: "Nickley", supervisorEmail: null, teamLeader: "Nickley", teamLeaderEmail: null, headOfSales: "Mburu Kinyanjui" },
    { principal: "EABL-Nyahururu", supervisor: "Erick", supervisorEmail: null, teamLeader: "Erick", teamLeaderEmail: null, headOfSales: "Alexander Muhoro" },
  ];

  it("orders by Head of Sales, Supervisor and principal, and limits to 15 rows", () => {
    const example = leadershipExample(input);
    expect(example.rows.map((row) => row[0])).toEqual(["EABL-Nyahururu", "Mars-Nairobi", "Bic-Nairobi"]);
    const many = Array.from({ length: 30 }, (_, index) => ({ ...input[0], principal: `P${index}-Nairobi` }));
    expect(leadershipExample(many).rows).toHaveLength(15);
  });

  it("reads back through the real leadership parser", () => {
    const parsed = parseSalesLeadershipCsv(Buffer.from(exampleToCsv(leadershipExample(input)), "utf-8"));
    expect(parsed).toHaveLength(3);
    expect(parsed.find((row) => row.principal === "Mars-Nairobi")).toMatchObject({ supervisorName: "Lucy", supervisorEmail: "lucy@pinefrost.co.ke", teamLeaderName: "Lucy", hodName: "Mburu Kinyanjui" });
  });
});

describe("the Upfield outlet list example", () => {
  const outlet = (code: string, channel: string | null, overrides: Partial<UpfieldOutletInput> = {}): UpfieldOutletInput => ({
    outletCode: code,
    outletName: `Outlet ${code}`,
    company: "Upfield",
    contactName: "Jane",
    phone: "0712345678",
    outletType: "Shop",
    channel,
    territory: "Nairobi",
    fsrName: "Brian Mwaura",
    fsrLogin: "Brian.Pinefrost",
    location: "Ruaka",
    latitude: -1.2,
    longitude: 36.8,
    routeDay: "monday",
    routeWeek: "Week 1",
    ...overrides,
  });

  it("takes outlets in turn from each channel, best-filled first, up to twelve", () => {
    const outlets = [...Array.from({ length: 10 }, (_, index) => outlet(`R${index}`, "retail")), outlet("W1", "wholesale"), outlet("L1", "LMT"), outlet("L0", "LMT", { company: null, contactName: null })];
    const example = upfieldOutletsExample(outlets);
    expect(example.rows).toHaveLength(12);
    expect(example.rows.slice(0, 3).map((row) => row[6]).sort()).toEqual(["LMT", "retail", "wholesale"]);
    expect(exampleValue(example, "Channel")).not.toBe("");
  });

  it("reads back through the real parser, banner row and all, keeping the FSR login and the GPS point", () => {
    const workbook = exampleToXlsx(upfieldOutletsExample([outlet("C1", "retail"), outlet("C2", "wholesale", { latitude: null, longitude: null, fsrLogin: null })]), { sheetName: "OutletsList", banner: ["From: 2026-01-01 To: 2026-11-23"] });
    const parsed = parseUpfieldOutletMaster(workbook);
    expect(parsed.rows.map((row) => row.outletCode).sort()).toEqual(["C1", "C2"]);
    const first = parsed.rows.find((row) => row.outletCode === "C1")!;
    expect(first).toMatchObject({ fsrName: "Brian Mwaura", fsrLogin: "Brian.Pinefrost", latitude: -1.2, longitude: 36.8, outletType: "Shop", channel: "retail", routeDay: "monday", phone: "0712345678" });
    expect(parsed.rows.find((row) => row.outletCode === "C2")).toMatchObject({ fsrName: "Brian Mwaura", fsrLogin: null, latitude: null });
  });
});

describe("exampleValue", () => {
  it("gives a column's first non-empty value, or blank", () => {
    const table = { columns: ["A", "B"], rows: [["", 1], ["x", 2]] };
    expect(exampleValue(table, "A")).toBe("x");
    expect(exampleValue(table, "B")).toBe("1");
    expect(exampleValue(table, "Nope")).toBe("");
    expect(exampleValue(null, "A")).toBe("");
  });
});
