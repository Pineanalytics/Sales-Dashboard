import { describe, expect, it } from "vitest";
import { DEFAULT_SUB_REGION, defaultSubRegion, isValidMarsPlacement, marsRegionOf, marsSubRegionsOf } from "../lib/marsStructure";
import { classifyReps, parseMarsRosterCsv, planAssignments, type ExistingAssignment, type RepActivity, type RosterCsvRow } from "../lib/marsRoster";

const HEADER = "Employee Name,Employee Code,Employee Group,Region,Location,Team Leader,Seller Type";
const row = (over: Partial<RosterCsvRow> = {}): RosterCsvRow => ({ employeeName: "Agnes Chelangat", employeeCode: "1177", employeeGroup: "TDR", region: "Nairobi", location: "Nairobi Lower", teamLeader: "Zachary Mwangi", sellerType: "Secondary Sales", ...over });
const asOf = new Date("2026-10-14T12:00:00Z");
const seen = (name: string, daysAgo: number, events90 = 5): [string, RepActivity] => [name.toLowerCase(), { name: name.toLowerCase(), events90, lastSale: new Date(asOf.getTime() - daysAgo * 86_400_000), activeDays90: 3 }];

describe("Mars structure", () => {
  it("has Nairobi with three sub-regions, Eastern with two and Central with one", () => {
    expect(marsSubRegionsOf("Nairobi")).toEqual(["Nairobi Lower", "Nairobi Metro", "Nairobi South", "Nairobi Key Accounts"]);
    expect(marsSubRegionsOf("Eastern")).toEqual(["Lower Eastern", "Upper Eastern"]);
    expect(marsSubRegionsOf("Central")).toEqual(["Central"]);
    expect(marsSubRegionsOf("Mombasa")).toEqual([]);
  });

  it("knows which region a sub-region belongs to and whether a pair fits", () => {
    expect(marsRegionOf("Upper Eastern")).toBe("Eastern");
    expect(marsRegionOf("nairobi metro")).toBe("Nairobi");
    expect(marsRegionOf("Nairobi Key Accounts")).toBe("Nairobi");
    expect(marsRegionOf("Isiolo")).toBeNull();
    expect(isValidMarsPlacement("Eastern", "Lower Eastern")).toBe(true);
    expect(isValidMarsPlacement("Nairobi", "Upper Eastern")).toBe(false);
  });

  it("defaults other principals to Nairobi Metro, Upper Eastern and Central, and Mars to nothing", () => {
    expect(DEFAULT_SUB_REGION).toEqual({ Nairobi: "Nairobi Metro", Eastern: "Upper Eastern", Central: "Central" });
    expect(defaultSubRegion("Suntory-Nairobi", "Nairobi")).toBe("Nairobi Metro");
    expect(defaultSubRegion("Weetabix-Nairobi", "Eastern")).toBe("Upper Eastern");
    expect(defaultSubRegion("EABL-Nyeri", "Central")).toBe("Central");
    expect(defaultSubRegion("Mars-Nairobi", "Nairobi")).toBeNull();
    expect(defaultSubRegion("Suntory-Nairobi", "Coast")).toBeNull();
  });
});

describe("reading the roster file", () => {
  it("reads rows, trims and collapses names", () => {
    const parsed = parseMarsRosterCsv(`${HEADER}\nAlex  Kithure ,739,MBSR,Eastern,Upper Eastern,Shekila Hassan,Secondary Sales\n`);
    expect(parsed.problems).toEqual([]);
    expect(parsed.rows[0]).toMatchObject({ employeeName: "Alex Kithure", employeeCode: "739", location: "Upper Eastern" });
  });

  it("reports a missing column, a repeated code, a missing code and a sub-region in the wrong region", () => {
    expect(parseMarsRosterCsv("Employee Name,Employee Code\nA,1\n").problems[0]).toMatch(/Missing column/);
    const parsed = parseMarsRosterCsv(
      `${HEADER}\nA,1,MBSR,Nairobi,Nairobi Metro,Lewis Muthomi,Secondary Sales\nB,1,MBSR,Nairobi,Nairobi Metro,Lewis Muthomi,Secondary Sales\nC,,MBSR,Nairobi,Nairobi Metro,Lewis Muthomi,Secondary Sales\nD,4,MBSR,Nairobi,Upper Eastern,Lewis Muthomi,Secondary Sales\n`
    );
    expect(parsed.problems.some((p) => /appears twice/.test(p))).toBe(true);
    expect(parsed.problems.some((p) => /no employee code/.test(p))).toBe(true);
    expect(parsed.problems.some((p) => /not a sub-region of Nairobi/.test(p))).toBe(true);
  });
});

describe("active and inactive workers", () => {
  it("is Active with a Mars sale in the last 90 days and Inactive after, with the reason and last sale", () => {
    const rows = [row({ employeeName: "Recent Rep", employeeCode: "1" }), row({ employeeName: "Old Rep", employeeCode: "2" }), row({ employeeName: "Never Rep", employeeCode: "3" })];
    const activity = new Map([seen("Recent Rep", 3), seen("Old Rep", 95)]);
    const classes = classifyReps(rows, activity, new Set(), asOf);
    expect(classes.get("1")).toMatchObject({ status: "Active", reason: "Last Mars sale 2026-10-11" });
    expect(classes.get("2")).toMatchObject({ status: "Inactive", reason: "No Mars sale since 2026-07-11 (95 days)" });
    expect(classes.get("3")).toMatchObject({ status: "Inactive", reason: "No Mars sale this year" });
  });

  it("honours a different cut-off", () => {
    const rows = [row({ employeeName: "Old Rep", employeeCode: "2" })];
    expect(classifyReps(rows, new Map([seen("Old Rep", 95)]), new Set(), asOf, 120).get("2")?.status).toBe("Active");
  });

  it("always treats a test account as Inactive", () => {
    const rows = [row({ employeeName: "test mbsr", employeeCode: "9", employeeGroup: "MBSR" }), row({ employeeName: "Somebody", employeeCode: "8", employeeGroup: "Test" })];
    const classes = classifyReps(rows, new Map([seen("test mbsr", 1), seen("Somebody", 1)]), new Set(), asOf);
    expect(classes.get("9")).toMatchObject({ status: "Inactive", reason: "Test account" });
    expect(classes.get("8")?.status).toBe("Inactive");
  });

  it("gives the sales of a name that holds two codes to the one that is live in the roster", () => {
    const rows = [row({ employeeName: "Veronica Wambua", employeeCode: "968" }), row({ employeeName: "Veronica Wambua", employeeCode: "1004" })];
    const classes = classifyReps(rows, new Map([seen("Veronica Wambua", 0)]), new Set(["1004"]), asOf);
    expect(classes.get("1004")?.status).toBe("Active");
    expect(classes.get("968")).toMatchObject({ status: "Inactive", reason: "Same name as code 1004, which carries the sales" });
  });
});

describe("planning the assignments", () => {
  const existing = (over: Partial<ExistingAssignment> = {}): ExistingAssignment => ({ id: "a1", teamLeaderId: "t1", teamLeaderName: "Benson Mbivi", employeeCode: "1177", active: true, region: null, subRegion: null, workGroup: null, ...over });

  it("applies the roster's Team Leader, region, sub-region and group to an existing rep", () => {
    const rows = [row()];
    const plan = planAssignments(rows, classifyReps(rows, new Map([seen("Agnes Chelangat", 1)]), new Set(["1177"]), asOf), [existing()]);
    expect(plan.moved).toBe(1);
    expect(plan.regionChanged).toBe(1);
    expect(plan.actions[0]).toMatchObject({ kind: "update", moveTeamLeader: true });
  });

  it("changes nothing for a rep already in place", () => {
    const rows = [row()];
    const plan = planAssignments(rows, classifyReps(rows, new Map([seen("Agnes Chelangat", 1)]), new Set(["1177"]), asOf), [existing({ teamLeaderName: "Zachary Mwangi", region: "Nairobi", subRegion: "Nairobi Lower", workGroup: "TDR" })]);
    expect(plan.actions[0].kind).toBe("none");
  });

  it("makes a live assignment inactive when the rep has stopped selling, and adds only active reps that are not on the roster", () => {
    const rows = [row({ employeeName: "Stopped", employeeCode: "5" }), row({ employeeName: "New Active", employeeCode: "6" }), row({ employeeName: "New Quiet", employeeCode: "7" })];
    const classes = classifyReps(rows, new Map([seen("Stopped", 120), seen("New Active", 2)]), new Set(["5"]), asOf);
    const plan = planAssignments(rows, classes, [existing({ employeeCode: "5", teamLeaderName: "Zachary Mwangi", region: "Nairobi", subRegion: "Nairobi Lower", workGroup: "TDR" })]);
    expect(plan.deactivated).toBe(1);
    expect(plan.created).toBe(1);
    expect(plan.actions.filter((a) => a.kind === "create").map((a) => (a as { row: RosterCsvRow }).row.employeeCode)).toEqual(["6"]);
  });

  it("leaves live assignments that are not in the file as they are, and reports them", () => {
    const plan = planAssignments([], new Map(), [existing({ employeeCode: "1181" })]);
    expect(plan.notInFile).toHaveLength(1);
    expect(plan.actions).toHaveLength(0);
  });
});
