import { describe, expect, it } from "vitest";

import {
  DEFAULT_UKL_EXPORT_RECONCILE_DAYS,
  parseUklExportReconcileDays,
  parseUklExportManifestRange,
  toUklExportManifestDay,
} from "../lib/uklSalesExportManifest";

describe("UKL Sales export manifest", () => {
  it("uses the bounded default and rejects invalid lookback windows", () => {
    expect(parseUklExportReconcileDays(null)).toBe(DEFAULT_UKL_EXPORT_RECONCILE_DAYS);
    expect(parseUklExportReconcileDays("2")).toBe(2);
    expect(parseUklExportReconcileDays("62")).toBe(62);
    expect(parseUklExportReconcileDays("1")).toBeNull();
    expect(parseUklExportReconcileDays("63")).toBeNull();
    expect(parseUklExportReconcileDays("35.5")).toBeNull();
  });

  it("accepts an exact yesterday/today manifest range", () => {
    const range = parseUklExportManifestRange("2026-08-30", "2026-08-31");
    expect(range?.start.toISOString()).toBe("2026-08-30T00:00:00.000Z");
    expect(range?.endExclusive.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(range?.dayCount).toBe(2);
  });

  it("rejects invalid, reversed, or overlong explicit ranges", () => {
    expect(parseUklExportManifestRange("2026-02-30", "2026-03-01")).toBeNull();
    expect(parseUklExportManifestRange("2026-09-01", "2026-08-31")).toBeNull();
    expect(parseUklExportManifestRange("2026-01-01", "2026-04-01")).toBeNull();
    expect(parseUklExportManifestRange("2026-08-30", null)).toBeNull();
  });

  it("changes the revision when a branch day is replaced", () => {
    const first = toUklExportManifestDay({
      date: "2026-08-29",
      rowCount: 172,
      lastReplacedAt: new Date("2026-08-31T02:00:00.000Z"),
    });
    const replaced = toUklExportManifestDay({
      date: "2026-08-29",
      rowCount: 172,
      lastReplacedAt: new Date("2026-08-31T02:05:00.000Z"),
    });

    expect(first.rowCount).toBe(172);
    expect(first.revision).not.toBe(replaced.revision);
    expect(replaced.lastReplacedAt).toBe("2026-08-31T02:05:00.000Z");
  });
});
