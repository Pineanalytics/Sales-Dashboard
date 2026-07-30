import { describe, expect, it } from "vitest";
import { compareTimeManagementRows, firstCallStatus, nairobiMinutesAfterMidnight } from "../lib/timeManagement";

describe("first-call time-management policy", () => {
  it("uses Africa/Nairobi time rather than the browser timezone", () => {
    expect(nairobiMinutesAfterMidnight("2026-07-30T06:00:00.000Z")).toBe(9 * 60);
  });

  it("recognizes 09:00 and earlier as on time", () => {
    expect(firstCallStatus("2026-07-30T05:59:00.000Z")).toBe("on-time");
    expect(firstCallStatus("2026-07-30T06:00:00.000Z")).toBe("on-time");
  });

  it("keeps the 09:01-09:29 grace window neutral and marks 09:30 late", () => {
    expect(firstCallStatus("2026-07-30T06:01:00.000Z")).toBe("grace");
    expect(firstCallStatus("2026-07-30T06:29:00.000Z")).toBe("grace");
    expect(firstCallStatus("2026-07-30T06:30:00.000Z")).toBe("late");
  });

  it("sorts latest late starters first and on-time reps at the bottom", () => {
    const rows = [
      { salesRep: "On time", firstCall: "2026-07-30T05:50:00.000Z" },
      { salesRep: "Late at 10", firstCall: "2026-07-30T07:00:00.000Z" },
      { salesRep: "Grace", firstCall: "2026-07-30T06:15:00.000Z" },
      { salesRep: "Late at 9:30", firstCall: "2026-07-30T06:30:00.000Z" },
      { salesRep: "Early", firstCall: "2026-07-30T05:30:00.000Z" },
    ];

    expect(rows.sort(compareTimeManagementRows).map((row) => row.salesRep)).toEqual(["Late at 10", "Late at 9:30", "Grace", "Early", "On time"]);
  });
});
