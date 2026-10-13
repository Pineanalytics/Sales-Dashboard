import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { parseGeoPoint, parseUpfieldOutletMaster, splitFsr, summarizeUpfieldOutletMaster, UpfieldMasterParseError } from "../lib/upfieldOutletMaster";

const HEADER = ["Company", "Route_FSR", "Territory", "Outlet_Code", "Outlet_Name", "Contact Name", "Phone", "Type", "Channel", "GeoPoint", "Location", "Route_Day", "Route_Week"];

function workbook(rows: unknown[][], banner = true): Buffer {
  const aoa = [...(banner ? [["From: 2000-01-01  To: 2026-10-13 "]] : []), HEADER, ...rows];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Worksheet");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

const row = (code: string, over: Partial<Record<number, unknown>> = {}) => {
  const base: unknown[] = ["PINEFROST LIMITED", "Brian Mwaura (Dolphine.Pinefrost)", "PINEFROST", code, `Outlet ${code}`, "Contact", "0712345678", "Kiosk", "retail", "-1.3920458,36.9403915", "Kayole", "Monday", "1;2"];
  for (const [i, v] of Object.entries(over)) base[Number(i)] = v;
  return base;
};

describe("splitFsr", () => {
  it("separates the rep's name from their login", () => {
    expect(splitFsr("Brian Mwaura (Dolphine.Pinefrost)")).toEqual({ name: "Brian Mwaura", login: "Dolphine.Pinefrost" });
    expect(splitFsr("Rose  Wanjiru (Eunice.Pinefrost)")).toEqual({ name: "Rose Wanjiru", login: "Eunice.Pinefrost" });
    expect(splitFsr("Van Only")).toEqual({ name: "Van Only", login: null });
    expect(splitFsr("")).toEqual({ name: null, login: null });
  });
});

describe("parseGeoPoint", () => {
  it("reads a Kenyan latitude,longitude and tolerates a trailing comma", () => {
    expect(parseGeoPoint("-1.3920458,36.9403915")).toEqual({ latitude: -1.3920458, longitude: 36.9403915 });
    expect(parseGeoPoint("-1.294431,36.8677132,")).toEqual({ latitude: -1.294431, longitude: 36.8677132 });
  });

  it("rejects points outside Kenya or unreadable, and puts a swapped pair the right way round", () => {
    expect(parseGeoPoint("0.32177688904852186,32.61082090437412")).toBeNull(); // Uganda
    expect(parseGeoPoint("36.94,-1.39")).toEqual({ latitude: -1.39, longitude: 36.94 }); // swapped columns
    expect(parseGeoPoint("abc,def")).toBeNull();
    expect(parseGeoPoint("")).toBeNull();
  });
});

describe("parseUpfieldOutletMaster", () => {
  it("finds the header below the banner and reads every column", () => {
    const { rows } = parseUpfieldOutletMaster(workbook([row("301582"), row("384528", { 7: "Wholesaler", 8: "wholesale" })]));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      outletCode: "301582",
      outletName: "Outlet 301582",
      company: "PINEFROST LIMITED",
      fsrName: "Brian Mwaura",
      fsrLogin: "Dolphine.Pinefrost",
      outletType: "Kiosk",
      channel: "retail",
      location: "Kayole",
      routeDay: "monday",
      routeWeek: "1;2",
      latitude: -1.3920458,
      longitude: 36.9403915,
    });
    expect(rows[1]).toMatchObject({ outletType: "Wholesaler", channel: "wholesale" });
  });

  it("works without a banner row", () => {
    expect(parseUpfieldOutletMaster(workbook([row("1")], false)).rows).toHaveLength(1);
  });

  it("keeps the last of duplicate codes, skips rows with no code, and says so", () => {
    const { rows, warnings } = parseUpfieldOutletMaster(workbook([row("1", { 4: "First" }), row("1", { 4: "Second" }), row("", { 4: "No code" }), row("2")]));
    expect(rows.map((r) => r.outletCode)).toEqual(["1", "2"]);
    expect(rows[0].outletName).toBe("Second");
    expect(warnings.join(" ")).toMatch(/1 duplicate/);
    expect(warnings.join(" ")).toMatch(/1 row\(s\) with no Outlet_Code/);
  });

  it("stores no coordinates for a point outside Kenya, and warns", () => {
    const { rows, warnings } = parseUpfieldOutletMaster(workbook([row("1", { 9: "0.32,32.61" }), row("2", { 9: "" })]));
    expect(rows[0].latitude).toBeNull();
    expect(rows[1].latitude).toBeNull();
    expect(warnings.join(" ")).toMatch(/outside Kenya/);
    expect(warnings.join(" ")).toMatch(/no GPS point/);
  });

  it("refuses a file that is not the outlet list", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Principal", "Value"], ["Mars", 1]]), "Sheet1");
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    expect(() => parseUpfieldOutletMaster(buffer)).toThrow(UpfieldMasterParseError);
    expect(() => parseUpfieldOutletMaster(Buffer.from("not a workbook"))).toThrow(UpfieldMasterParseError);
  });
});

describe("summarizeUpfieldOutletMaster", () => {
  it("counts outlets by channel, type and FSR, largest first", () => {
    const { rows } = parseUpfieldOutletMaster(workbook([row("1"), row("2"), row("3", { 8: "wholesale", 7: "Wholesaler" })]));
    const summary = summarizeUpfieldOutletMaster(rows);
    expect(summary.byChannel).toEqual([["retail", 2], ["wholesale", 1]]);
    expect(summary.byType[0]).toEqual(["Kiosk", 2]);
    expect(summary.byFsr).toEqual([["Brian Mwaura", 3]]);
  });
});
