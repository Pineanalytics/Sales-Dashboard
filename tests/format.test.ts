import { describe, expect, it } from "vitest";
import { strikeRateTier } from "../lib/format";

describe("strike-rate colour policy", () => {
  it("uses green at 75% and above", () => {
    expect(strikeRateTier(75)).toBe("good");
    expect(strikeRateTier(100)).toBe("good");
  });

  it("uses amber from 50% through 74.9%", () => {
    expect(strikeRateTier(50)).toBe("warn");
    expect(strikeRateTier(74.9)).toBe("warn");
  });

  it("uses red below 50%", () => {
    expect(strikeRateTier(49.9)).toBe("bad");
  });
});
