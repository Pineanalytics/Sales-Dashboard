import { describe, expect, it } from "vitest";
import { resolveRepBySapName } from "@/scripts/db-bridge/transform/buildRepSales";

const row = (employeeCode: string, sapName: string, active: boolean) => ({ employeeCode, pineName: sapName, sapName, active });

describe("resolveRepBySapName", () => {
  it("matches a name held by one roster row", () => {
    expect(resolveRepBySapName([row("1", "Jane Wanjiru", true)])("jane  wanjiru").employeeCode).toBe("1");
  });

  it("settles a shared name on the one active row, so a recreated profile keeps its sales", () => {
    const resolve = resolveRepBySapName([row("1114", "Florence Ouma", false), row("1221", "Florence Ouma", true)]);
    expect(resolve("Florence Ouma")).toEqual({ employeeCode: "1221", employeeName: "Florence Ouma" });
  });

  it("stays unmatched when two active rows share the name, or none is active", () => {
    expect(resolveRepBySapName([row("1", "A B", true), row("2", "A B", true)])("A B").employeeCode).toBeNull();
    expect(resolveRepBySapName([row("1", "A B", false), row("2", "A B", false)])("A B").employeeCode).toBeNull();
  });

  it("returns nothing for an unknown name", () => {
    expect(resolveRepBySapName([row("1", "A B", true)])("Someone Else")).toEqual({ employeeCode: null, employeeName: null });
  });
});
