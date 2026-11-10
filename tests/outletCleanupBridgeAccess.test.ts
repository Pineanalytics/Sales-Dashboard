import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  teamLeader: { findFirst: vi.fn(), findMany: vi.fn() },
  supervisor: { findFirst: vi.fn() },
  employeeMaster: { findFirst: vi.fn() },
}));
vi.mock("@/auth", () => ({ auth: async () => null }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { mayApprove, mayValidate, resolveBridgeActor, resolveCleanupActor, rowInScope, runAsBridgeActor } from "@/lib/outletCleanup/access";
import type { CleanupActor } from "@/lib/outletCleanup/types";

const actor = (over: Partial<CleanupActor>): CleanupActor => ({ email: "a@x.ke", role: "TEAM_LEADER", isAdmin: false, canReview: true, canSeeAll: false, teamLeaders: ["Eve Theuri"], displayName: "Eve Theuri", ...over });

beforeEach(() => vi.clearAllMocks());

describe("who may approve and validate", () => {
  it("lets team leaders and supervisors approve a rep's work, and only supervisors and admins validate", () => {
    expect(mayApprove(actor({ role: "TEAM_LEADER" }))).toBe(true);
    expect(mayApprove(actor({ role: "SUPERVISOR" }))).toBe(true);
    expect(mayApprove(actor({ role: "REP" }))).toBe(false);
    expect(mayApprove(actor({ role: "HOD" }))).toBe(false);
    expect(mayValidate(actor({ role: "SUPERVISOR" }))).toBe(true);
    expect(mayValidate(actor({ role: "ADMIN", isAdmin: true }))).toBe(true);
    expect(mayValidate(actor({ role: "TEAM_LEADER" }))).toBe(false);
    expect(mayValidate(actor({ role: "REP" }))).toBe(false);
  });
});

describe("which outlet rows a person works on", () => {
  it("gives a team leader the rows of their team, ignoring case and spacing", () => {
    expect(rowInScope(actor({}), { teamLeader: "  eve   theuri " })).toBe(true);
    expect(rowInScope(actor({}), { teamLeader: "Lewis" })).toBe(false);
  });

  it("gives a rep only the rows they sell, by user code, even inside their own team", () => {
    const rep = actor({ role: "REP", repCodes: ["1181"] });
    expect(rowInScope(rep, { teamLeader: "Eve Theuri", repCode: "1181" })).toBe(true);
    expect(rowInScope(rep, { teamLeader: "Eve Theuri", repCode: "1182" })).toBe(false);
    expect(rowInScope(rep, { teamLeader: "Eve Theuri", repCode: null })).toBe(false);
  });
});

describe("resolveBridgeActor", () => {
  it("needs a login to label the work", async () => {
    expect(await resolveBridgeActor({ role: "TEAM_LEADER", name: "Eve Theuri", email: "  " })).toEqual({ ok: false, status: 401 });
  });

  it("knows a team leader by the name on the roster, and refuses one who is not on it", async () => {
    prismaMock.teamLeader.findFirst.mockResolvedValueOnce({ name: "Eve Theuri" });
    const ok = await resolveBridgeActor({ role: "TEAM_LEADER", name: "eve theuri", email: "Eve.Theuri@pinefrost.co.ke" });
    expect(ok).toMatchObject({ ok: true, actor: { role: "TEAM_LEADER", isAdmin: false, canReview: true, teamLeaders: ["Eve Theuri"], email: "eve.theuri@pinefrost.co.ke" } });
    prismaMock.teamLeader.findFirst.mockResolvedValueOnce(null);
    expect(await resolveBridgeActor({ role: "TEAM_LEADER", name: "Nobody", email: "n@x.ke" })).toEqual({ ok: false, status: 403 });
  });

  it("gives a supervisor their team leaders and themselves, leaving out former ones", async () => {
    prismaMock.supervisor.findFirst.mockResolvedValueOnce({ id: "s1", name: "Lucy Wanjiku" });
    prismaMock.teamLeader.findMany.mockResolvedValueOnce([
      { name: "Eve Theuri", kind: "ACTIVE" },
      { name: "Old Leader", kind: "FORMER" },
    ]);
    const result = await resolveBridgeActor({ role: "SUPERVISOR", name: "Lucy Wanjiku", email: "lucy@x.ke" });
    expect(result.ok && result.actor.teamLeaders?.sort()).toEqual(["Eve Theuri", "Lucy Wanjiku"]);
  });

  it("limits a rep to their own user code and names their team leader as their team", async () => {
    prismaMock.employeeMaster.findFirst.mockResolvedValueOnce({ employeeCode: "1181", pineName: "Isabellah W", teamLeader: "Eve Theuri" });
    const result = await resolveBridgeActor({ role: "REP", repCode: "1181", email: "isabellah@x.ke" });
    expect(result).toMatchObject({ ok: true, actor: { role: "REP", repCodes: ["1181"], teamLeaders: ["Eve Theuri"], isAdmin: false } });
    prismaMock.employeeMaster.findFirst.mockResolvedValueOnce(null);
    expect(await resolveBridgeActor({ role: "REP", repCode: "9999", email: "x@x.ke" })).toEqual({ ok: false, status: 403 });
    expect(await resolveBridgeActor({ role: "REP", email: "x@x.ke" })).toEqual({ ok: false, status: 403 });
  });

  it("lets HOD and Director view everything but change nothing", async () => {
    const result = await resolveBridgeActor({ role: "HOD", name: "Angela", email: "a@x.ke" });
    expect(result).toMatchObject({ ok: true, actor: { canSeeAll: true, canReview: false, isAdmin: false, teamLeaders: null } });
  });
});

describe("the bridge actor store", () => {
  it("is what the cleanup's own handlers see while the bridge runs them, and nothing otherwise", async () => {
    expect(await resolveCleanupActor()).toEqual({ ok: false, status: 401 });
    const bridge = actor({ email: "eve@x.ke" });
    const seen = await runAsBridgeActor(bridge, () => resolveCleanupActor());
    expect(seen).toEqual({ ok: true, actor: bridge });
    expect(await resolveCleanupActor()).toEqual({ ok: false, status: 401 });
  });
});
