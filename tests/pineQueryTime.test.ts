import { describe, expect, it } from "vitest";
import { formatPineLocalDate, formatPineLocalDateTime } from "../scripts/db-bridge/active-outlets/query";

describe("Pine MySQL query bounds", () => {
  it("uses Nairobi wall-clock time for the live sales/orders cutoff", () => {
    expect(formatPineLocalDateTime(new Date("2026-08-12T09:35:02.000Z"))).toBe("2026-08-12 12:35:02");
  });

  it("uses the Nairobi calendar date around UTC midnight", () => {
    expect(formatPineLocalDate(new Date("2026-08-12T22:30:00.000Z"))).toBe("2026-08-13");
  });
});
