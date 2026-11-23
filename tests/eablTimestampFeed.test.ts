import { describe, expect, it } from "vitest";
import { dataFeedById, EABL_TIMESTAMP_COLUMNS, EABL_TIMESTAMPS_FEED, powerQueryScript } from "@/lib/dataFeedScript";
import { eablTimestampCsv, eablTimestampRows, resolveEablTimestampPeriod, type EablCallRow } from "@/lib/eablTimestampFeed";

const at = (hms: string | null) => (hms ? new Date(`1970-01-01T${hms}Z`) : null);

function call(overrides: Partial<Omit<EablCallRow, "timeIn" | "timeOut">> & { timeIn: string | null; timeOut: string | null }): EablCallRow {
  const { timeIn, timeOut, ...rest } = overrides;
  return {
    callDate: new Date("2026-11-20T00:00:00Z"),
    salesman: "Geoffrey Kimaru",
    agent: null,
    customerCode: "KE001",
    customerName: "Shop One",
    customerType: "Bar",
    segment: "Bar",
    timeIn: at(timeIn),
    timeOut: at(timeOut),
    durationMinutes: 10,
    firstCallOfDay: at("08:00:00"),
    lastCallOfDay: at("16:00:00"),
    callsInDay: 3,
    productiveCallsInDay: 2,
    dayStrikeRatePct: 66.666,
    cashSales: 100,
    creditSales: 50,
    discounts: 0,
    netSales: 150,
    isProductive: true,
    ...rest,
  };
}

describe("the EABL timestamp feed period", () => {
  const now = new Date("2026-11-23T10:00:00Z");

  it("counts the last 30 days including today, in Nairobi time", () => {
    const period = resolveEablTimestampPeriod("last30", now);
    expect(period.start.toISOString().slice(0, 10)).toBe("2026-10-25");
    expect(period.endExclusive.toISOString().slice(0, 10)).toBe("2026-11-24");
    expect(period.label).toBe("Last 30 days (2026-10-25 to 2026-11-23)");
  });

  it("uses Nairobi's date when UTC has not rolled over yet", () => {
    const period = resolveEablTimestampPeriod("month", new Date("2026-11-30T22:30:00Z"));
    expect(period.start.toISOString().slice(0, 10)).toBe("2026-12-01");
    expect(period.endExclusive.toISOString().slice(0, 10)).toBe("2026-12-02");
  });

  it("covers this month, 90 days and the year to date, and falls back to the default", () => {
    expect(resolveEablTimestampPeriod("month", now).start.toISOString().slice(0, 10)).toBe("2026-11-01");
    expect(resolveEablTimestampPeriod("last90", now).start.toISOString().slice(0, 10)).toBe("2026-08-26");
    expect(resolveEablTimestampPeriod("ytd", now).start.toISOString().slice(0, 10)).toBe("2026-01-01");
    expect(resolveEablTimestampPeriod("nonsense", now).value).toBe("last30");
    expect(resolveEablTimestampPeriod(null, now).value).toBe("last30");
  });
});

describe("the EABL timestamp rows", () => {
  it("numbers each salesman's day by check-in and works out the gap from the previous check-out", () => {
    const rows = eablTimestampRows([
      call({ customerName: "C", timeIn: "10:30:00", timeOut: "10:40:00" }),
      call({ customerName: "A", timeIn: "09:00:00", timeOut: "09:15:30" }),
      call({ customerName: "B", timeIn: "09:30:00", timeOut: "09:45:00" }),
    ]);
    expect(rows.map((row) => row.Customer)).toEqual(["A", "B", "C"]);
    expect(rows.map((row) => row["Call No"])).toEqual([1, 2, 3]);
    expect(rows.map((row) => row["Gap From Previous Call (Min)"])).toEqual(["", 14.5, 45]);
    expect(rows[0]["Time In"]).toBe("09:00:00");
    expect(rows[0]["Time Out"]).toBe("09:15:30");
  });

  it("restarts the count for another salesman or another day, and leaves a call with no check-in unnumbered", () => {
    const rows = eablTimestampRows([
      call({ salesman: "Ann", timeIn: "09:00:00", timeOut: "09:10:00" }),
      call({ salesman: "Ann", timeIn: null, timeOut: null, customerName: "No visit" }),
      call({ salesman: "Ann", callDate: new Date("2026-11-21T00:00:00Z"), timeIn: "09:05:00", timeOut: "09:20:00" }),
      call({ salesman: "Bob", timeIn: "09:20:00", timeOut: "09:30:00" }),
    ]);
    expect(rows.map((row) => `${row["Call Date"]} ${row.Salesman} ${row["Call No"]}`.trim())).toEqual([
      "2026-11-20 Ann 1",
      "2026-11-20 Ann",
      "2026-11-20 Bob 1",
      "2026-11-21 Ann 1",
    ]);
    expect(rows.find((row) => row.Customer === "No visit")?.["Time In"]).toBe("");
    expect(rows.find((row) => row.Customer === "No visit")?.["Gap From Previous Call (Min)"]).toBe("");
    const bob = rows.find((row) => row.Salesman === "Bob")!;
    expect(bob["Call No"]).toBe(1);
    expect(bob["Gap From Previous Call (Min)"]).toBe("");
  });

  it("shows an overlap with the previous call as a negative gap", () => {
    const rows = eablTimestampRows([
      call({ timeIn: "09:00:00", timeOut: "09:20:00" }),
      call({ timeIn: "09:15:00", timeOut: "09:30:00" }),
    ]);
    expect(rows[1]["Gap From Previous Call (Min)"]).toBe(-5);
  });

  it("writes the CSV with the asked columns in order, quoting where needed and skipping unknown names", () => {
    const rows = eablTimestampRows([call({ customerName: 'Shop, "One"', timeIn: "09:00:00", timeOut: "09:10:00" })]);
    const csv = eablTimestampCsv(rows, ["Customer", "Bogus", "Time In", "Day Strike Rate %", "Productive"]);
    expect(csv).toBe('Customer,Time In,Day Strike Rate %,Productive\r\n"Shop, ""One""",09:00:00,66.67,Y');
  });
});

describe("the EABL timestamps feed definition", () => {
  it("is registered and serves every default column it names", () => {
    expect(dataFeedById("eabl-timestamps")).toBe(EABL_TIMESTAMPS_FEED);
    for (const column of EABL_TIMESTAMPS_FEED.defaultColumns) expect(EABL_TIMESTAMP_COLUMNS).toContain(column);
    expect(EABL_TIMESTAMPS_FEED.periods.map((period) => period.value)).toContain(EABL_TIMESTAMPS_FEED.defaultPeriod);
  });

  it("writes a script with the period up top and the time, date and number columns typed", () => {
    const script = powerQueryScript({ baseUrl: "https://pinefrostdb.com", feed: EABL_TIMESTAMPS_FEED, key: "pfk_abc" });
    expect(script).toContain('Period = "last30",');
    expect(script).toContain('RelativePath = "api/feeds/eabl-timestamps",');
    expect(script).toContain('{"Call Date", type date}');
    expect(script).toContain('{"Time In", type time}');
    expect(script).toContain('{"Gap From Previous Call (Min)", type number}');
    expect(script).toContain('{"Salesman", type text}');
    expect(script).toContain('Replacer.ReplaceValue, {"Call Date", "Call No", "Time In"');
  });
});
