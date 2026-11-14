import { describe, expect, it } from "vitest";
import { shapeRepTimestamps } from "@/lib/coachingRepTimestamps";

describe("shapeRepTimestamps", () => {
  const days = [
    { employeeCode: "1181", date: "2026-11-03", first_mins: 8 * 60 + 15, last_mins: 16 * 60 + 45, calls: 12, productive: 9, avg_interval: 40 },
    { employeeCode: "1181", date: "2026-11-02", first_mins: 9 * 60, last_mins: 15 * 60, calls: 8, productive: 4, avg_interval: null },
  ];
  const calls = [
    { employeeCode: "1181", date: "2026-11-03", time: "09:10", outletId: "B", outletName: "Duka B", callOutcome: "No Sale", noSaleReason: "Stocked", intervalMins: 55 },
    { employeeCode: "1181", date: "2026-11-03", time: "08:15", outletId: "A", outletName: "Duka A", callOutcome: "Sale", noSaleReason: null, intervalMins: null },
  ];

  it("gives each day its first and last call, hours and counts, oldest first, and the calls in time order", () => {
    const [rep] = shapeRepTimestamps(["1181"], days, calls);
    expect(rep.days.map((d) => d.date)).toEqual(["2026-11-02", "2026-11-03"]);
    expect(rep.days[1]).toMatchObject({ firstCall: "08:15", lastCall: "16:45", hoursInDay: 8.5, calls: 12, productiveCalls: 9, avgIntervalMins: 40 });
    expect(rep.days[1].callList?.map((c) => c.time)).toEqual(["08:15", "09:10"]);
    expect(rep.days[0].callList).toEqual([]);
    expect(rep.totals).toEqual({ daysWorked: 2, calls: 20, productiveCalls: 13, avgHoursInDay: 7.3, avgFirstCall: "08:38", avgLastCall: "15:53", avgIntervalMins: 40 });
  });

  it("leaves the call list out for long windows, and answers a code with no calls", () => {
    const [rep, none] = shapeRepTimestamps(["1181", "9999"], days, null);
    expect(rep.days[0].callList).toBeUndefined();
    expect(none).toEqual({ employeeCode: "9999", days: [], totals: { daysWorked: 0, calls: 0, productiveCalls: 0, avgHoursInDay: null, avgFirstCall: null, avgLastCall: null, avgIntervalMins: null } });
  });
});
