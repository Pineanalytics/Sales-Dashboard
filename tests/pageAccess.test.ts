import { describe, expect, it } from "vitest";
import { canAccessFinancials } from "@/lib/pageAccess";

describe("canAccessFinancials", () => {
  it("retains access for either existing Financials permission", () => {
    expect(canAccessFinancials("USER", ["receivables"])).toBe(true);
    expect(canAccessFinancials("USER", ["profitability"])).toBe(true);
  });

  it("allows administrators and rejects unrelated access", () => {
    expect(canAccessFinancials("ADMIN", [])).toBe(true);
    expect(canAccessFinancials("USER", ["coaching"])).toBe(false);
  });
});
