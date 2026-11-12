import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  repDirectoryEntry: { findMany: vi.fn(), createMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops)),
}));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { rosterMatchesFor, syncRepDirectory } from "@/lib/repDirectory";
import {
  buildPineEntries,
  buildSapEntries,
  deriveDataEdgeEntries,
  deriveEablEntries,
  deriveLeverageEntries,
  normalizeRepName,
  PINE_USERS_QUERY,
  type RepDirectoryInput,
} from "@/lib/repDirectoryBuild";

const NOW = new Date("2026-11-12T10:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

beforeEach(() => vi.clearAllMocks());

describe("normalizeRepName", () => {
  it("ignores case, punctuation and spacing", () => {
    expect(normalizeRepName("  Robert   MACHARIA ")).toBe("robert macharia");
    expect(normalizeRepName("O'Brien-Kamau, J.")).toBe("o brien kamau j");
    expect(normalizeRepName(null)).toBe("");
  });
});

describe("SAP entries", () => {
  const row = (over: Record<string, unknown> = {}) => ({ slpCode: 101, slpName: " Jane  Wanjiru ", active: "Y", locked: "N", principal: "Mars", branch: "Nairobi", salesUnit: "TDR", ...over }) as never;

  it("builds one active field rep per named salesperson, with the user fields as hints", () => {
    const [entry] = buildSapEntries([row()], new Map([[101, daysAgo(2)]]));
    expect(entry).toMatchObject({ sourceKey: "101", displayName: "Jane Wanjiru", origin: "TABLE", isActive: true, isFieldRep: true, principalHint: "Mars", branch: "Nairobi", groupLabel: "TDR" });
    expect(entry.lastActivityAt).toEqual(daysAgo(2));
  });

  it("marks inactive and locked people inactive, and SAP's no-sales-employee placeholder as neither active nor a field rep", () => {
    const entries = buildSapEntries([row({ slpCode: 102, active: "N" }), row({ slpCode: 103, locked: "Y" }), row({ slpCode: -1, slpName: "-No Sales Employee-" })], new Map());
    expect(entries.map((e) => e.isActive)).toEqual([false, false, false]);
    expect(entries[2].isFieldRep).toBe(false);
  });

  it("skips a salesperson with no name", () => {
    expect(buildSapEntries([row({ slpName: "  " }), row({ slpName: null })], new Map())).toEqual([]);
  });
});

describe("Pine entries", () => {
  const user = (over: Record<string, unknown> = {}) => ({ id: 1249, firstName: "Robert", lastName: "Macharia", salesGroup: "TDR", region: "Nairobi", active: 1, ...over }) as never;

  it("joins first and last name, keys by user id and flags the field groups", () => {
    const entries = buildPineEntries([user(), user({ id: 7, salesGroup: "STORE_PICKER" }), user({ id: 8, salesGroup: null })], new Map([["1249", daysAgo(0)]]));
    expect(entries[0]).toMatchObject({ sourceKey: "1249", displayName: "Robert Macharia", isActive: true, isFieldRep: true, groupLabel: "TDR", region: "Nairobi" });
    expect(entries[0].lastActivityAt).toEqual(daysAgo(0));
    expect(entries[1].isFieldRep).toBe(false);
    expect(entries[2]).toMatchObject({ isFieldRep: false, groupLabel: null });
  });

  it("treats a switched-off user as inactive and skips one with no name", () => {
    const entries = buildPineEntries([user({ active: 0 }), user({ id: 9, firstName: null, lastName: " " })], new Map());
    expect(entries).toHaveLength(1);
    expect(entries[0].isActive).toBe(false);
  });
});

describe("the Pine query never reads credentials", () => {
  it("names its columns, has no *, and selects nothing sensitive", () => {
    expect(PINE_USERS_QUERY).toBe("SELECT id, first_name, last_name, salesgroup, region, active FROM pine.users");
    expect(PINE_USERS_QUERY).not.toContain("*");
    for (const forbidden of ["password", "salt", "otp", "api", "email", "username", "phone", "gcmid", "remember_code", "activation_code", "forgotten_password"]) {
      expect(PINE_USERS_QUERY.toLowerCase()).not.toContain(forbidden);
    }
  });
});

describe("derived entries", () => {
  it("Leverage: one entry per branch and code, newest spelling wins, active only if recent", () => {
    const entries = deriveLeverageEntries(
      [
        { branch: "NAIROBI", repCode: "R1", repName: "Old Spelling", lastDate: daysAgo(40) },
        { branch: "NAIROBI", repCode: "R1", repName: "New Spelling", lastDate: daysAgo(3) },
        { branch: "NYERI", repCode: "R1", repName: "Other Branch Rep", lastDate: daysAgo(200) },
        { branch: "NYERI", repCode: "", repName: "No Code", lastDate: daysAgo(1) },
      ],
      NOW
    );
    expect(entries.map((e) => [e.sourceKey, e.displayName, e.isActive])).toEqual([
      ["NAIROBI|R1", "New Spelling", true],
      ["NYERI|R1", "Other Branch Rep", false],
    ]);
    expect(entries[0]).toMatchObject({ origin: "DERIVED", branch: "NAIROBI" });
  });

  it("DataEdge: merges transactions and visits, folds spelling, attaches the login from the outlet list", () => {
    const entries = deriveDataEdgeEntries(
      [{ fsr: "Peter  Kamau", lastDate: daysAgo(10) }, { fsr: null, lastDate: daysAgo(1) }],
      [{ fsr: "PETER KAMAU", lastDate: daysAgo(1) }, { fsr: "Mary Njeri", lastDate: daysAgo(120) }],
      [{ fsrName: "peter kamau", fsrLogin: "pkamau" }, { fsrName: "Mary Njeri", fsrLogin: null }],
      NOW
    );
    expect(entries).toHaveLength(2);
    const peter = entries.find((e) => e.displayName === "Peter Kamau")!;
    expect(peter).toMatchObject({ isActive: true, loginName: "pkamau", sourceKey: "Peter Kamau" });
    expect(peter.lastActivityAt).toEqual(daysAgo(1));
    expect(entries.find((e) => e.displayName === "Mary Njeri")).toMatchObject({ isActive: false, loginName: null });
  });

  it("EABL DMS: one entry per distinct salesman name", () => {
    const entries = deriveEablEntries([{ salesman: "John Mwangi", lastDate: daysAgo(5) }, { salesman: "john  mwangi", lastDate: daysAgo(2) }, { salesman: "", lastDate: null }], NOW);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ displayName: "John Mwangi", isActive: true });
    expect(entries[0].lastActivityAt).toEqual(daysAgo(2));
  });
});

describe("syncRepDirectory", () => {
  const input = (key: string, over: Partial<RepDirectoryInput> = {}): RepDirectoryInput => ({ sourceKey: key, displayName: `Rep ${key}`, origin: "TABLE", isActive: true, isFieldRep: true, ...over });
  const stored = (key: string, over: Record<string, unknown> = {}) => ({
    id: `id-${key}`, source: "SAP", sourceKey: key, displayName: `Rep ${key}`, normalizedName: `rep ${key}`, origin: "TABLE", isActive: true, isFieldRep: true,
    groupLabel: null, region: null, principalHint: null, branch: null, loginName: null, lastActivityAt: null, ...over,
  });

  it("adds new identities and leaves an unchanged one alone apart from its last-seen time", async () => {
    prismaMock.repDirectoryEntry.findMany.mockResolvedValue([stored("1")]);
    const result = await syncRepDirectory("SAP", [input("1"), input("2")], NOW);
    expect(result).toEqual({ created: 1, updated: 0, deactivated: 0, unchanged: 1 });
    expect(prismaMock.repDirectoryEntry.createMany.mock.calls[0][0].data[0]).toMatchObject({ source: "SAP", sourceKey: "2", normalizedName: "rep 2", firstSeenAt: NOW, lastSeenAt: NOW });
    expect(prismaMock.repDirectoryEntry.update).not.toHaveBeenCalled();
    expect(prismaMock.repDirectoryEntry.updateMany).toHaveBeenCalledWith({ where: { source: "SAP", sourceKey: { in: ["1", "2"] } }, data: { lastSeenAt: NOW } });
  });

  it("updates a renamed identity in place, keeping its key", async () => {
    prismaMock.repDirectoryEntry.findMany.mockResolvedValue([stored("1")]);
    const result = await syncRepDirectory("SAP", [input("1", { displayName: "Rep One Renamed" })], NOW);
    expect(result.updated).toBe(1);
    const call = prismaMock.repDirectoryEntry.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: "id-1" });
    expect(call.data).toMatchObject({ displayName: "Rep One Renamed", normalizedName: "rep one renamed", lastSeenAt: NOW });
  });

  it("marks an identity the source no longer sends inactive and never deletes", async () => {
    prismaMock.repDirectoryEntry.findMany.mockResolvedValue([stored("1"), stored("2"), stored("3", { isActive: false })]);
    // The shrink guard only applies to a directory of 20 or more, so this small one proceeds.
    const result = await syncRepDirectory("SAP", [input("1")], NOW);
    expect(result).toMatchObject({ deactivated: 1 });
    expect(prismaMock.repDirectoryEntry.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["id-2"] } }, data: { isActive: false } });
  });

  it("refuses a source that sends nothing, or far less than the directory holds, and changes nothing", async () => {
    prismaMock.repDirectoryEntry.findMany.mockResolvedValue([]);
    await expect(syncRepDirectory("SAP", [], NOW)).rejects.toThrow(/sent no reps/);
    const many = Array.from({ length: 40 }, (_, i) => stored(String(i)));
    prismaMock.repDirectoryEntry.findMany.mockResolvedValue(many);
    await expect(syncRepDirectory("SAP", [input("0"), input("1")], NOW)).rejects.toThrow(/failed read/);
    expect(prismaMock.repDirectoryEntry.createMany).not.toHaveBeenCalled();
    expect(prismaMock.repDirectoryEntry.update).not.toHaveBeenCalled();
    expect(prismaMock.repDirectoryEntry.updateMany).not.toHaveBeenCalled();
  });
});

describe("rosterMatchesFor", () => {
  const sam = { employeeCode: "1111", name: "Sam Otieno", active: true };
  const named = { ...sam, linked: false };
  const indexes = { bySapName: new Map([["sam otieno", [sam]]]), byPineName: new Map([["sam otieno", [sam]]]), byCode: new Map([["1111", sam]]) };

  it("matches SAP by SAP name and Pine by user id first, then by Pine name, all marked as name matches", () => {
    expect(rosterMatchesFor({ source: "SAP", sourceKey: "9", normalizedName: "sam otieno" }, indexes)).toEqual([named]);
    expect(rosterMatchesFor({ source: "PINE", sourceKey: "1111", normalizedName: "someone else" }, indexes)).toEqual([named]);
    expect(rosterMatchesFor({ source: "PINE", sourceKey: "5", normalizedName: "sam otieno" }, indexes)).toEqual([named]);
    expect(rosterMatchesFor({ source: "PINE", sourceKey: "5", normalizedName: "nobody" }, indexes)).toEqual([]);
  });

  it("derived sources match only by an explicit link", () => {
    expect(rosterMatchesFor({ source: "LEVERAGE", sourceKey: "NAIROBI|R1", normalizedName: "sam otieno" }, indexes)).toEqual([]);
    const linked = new Map([["LEVERAGE|NAIROBI|R1", [sam]]]);
    expect(rosterMatchesFor({ source: "LEVERAGE", sourceKey: "NAIROBI|R1", normalizedName: "sam otieno" }, { ...indexes, linked })).toEqual([{ ...sam, linked: true }]);
  });

  it("lists explicit links first and does not repeat an employee who is both linked and a name match", () => {
    const other = { employeeCode: "2222", name: "Sam Otieno Jr", active: true };
    const linked = new Map([["SAP|9", [other, sam]]]);
    const result = rosterMatchesFor({ source: "SAP", sourceKey: "9", normalizedName: "sam otieno" }, { ...indexes, linked });
    expect(result.map((match) => [match.employeeCode, match.linked])).toEqual([["2222", true], ["1111", true]]);
  });
});
