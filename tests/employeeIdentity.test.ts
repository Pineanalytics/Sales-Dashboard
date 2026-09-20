import { describe, it, expect } from "vitest";
import { resolveHomeTeamLeaderId } from "../lib/employeeIdentity";

describe("resolveHomeTeamLeaderId", () => {
  it("resolves to the one Team Leader when exactly one distinct candidate exists", () => {
    expect(resolveHomeTeamLeaderId(["tl1"])).toBe("tl1");
  });

  it("returns null when a rep has no active assignment at all", () => {
    expect(resolveHomeTeamLeaderId([])).toBeNull();
  });

  it("returns null when a rep is genuinely under more than one Team Leader", () => {
    expect(resolveHomeTeamLeaderId(["tl1", "tl2"])).toBeNull();
  });
});
