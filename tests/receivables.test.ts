import { describe, expect, it } from "vitest";
import { ageBucket } from "@/lib/receivables";

const asOf = new Date("2026-09-02T12:00:00.000Z");

describe("ageBucket", () => {
  it("keeps items due today or in the future current", () => {
    expect(ageBucket(new Date("2026-09-02T00:00:00.000Z"), asOf)).toBe("Current");
    expect(ageBucket(new Date("2026-09-03T00:00:00.000Z"), asOf)).toBe("Current");
  });

  it("uses inclusive due-date ageing boundaries", () => {
    expect(ageBucket(new Date("2026-09-01T00:00:00.000Z"), asOf)).toBe("1–30 days");
    expect(ageBucket(new Date("2026-08-03T00:00:00.000Z"), asOf)).toBe("1–30 days");
    expect(ageBucket(new Date("2026-08-02T00:00:00.000Z"), asOf)).toBe("31–60 days");
    expect(ageBucket(new Date("2026-07-04T00:00:00.000Z"), asOf)).toBe("31–60 days");
    expect(ageBucket(new Date("2026-07-03T00:00:00.000Z"), asOf)).toBe("61–90 days");
    expect(ageBucket(new Date("2026-06-04T00:00:00.000Z"), asOf)).toBe("61–90 days");
    expect(ageBucket(new Date("2026-06-03T00:00:00.000Z"), asOf)).toBe("Over 90 days");
  });
});
