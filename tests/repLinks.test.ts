import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  employeeMaster: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  employeeRepLink: { findUnique: vi.fn(), findMany: vi.fn(), upsert: vi.fn(), delete: vi.fn() },
  employeeRepLinkChange: { create: vi.fn() },
  repDirectoryEntry: { findUnique: vi.fn(), findMany: vi.fn() },
  teamLeaderAssignment: { findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
  $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops)),
}));
const authMock = vi.hoisted(() => vi.fn());
const recompute = vi.hoisted(() => ({ contribution: vi.fn(), targets: vi.fn(), identities: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/lib/repContribution", () => ({ recomputeRepContribution: recompute.contribution, recomputeDailyTargets: recompute.targets }));
vi.mock("@/lib/employeeIdentity", () => ({ resolveEmployeeIdentities: recompute.identities }));

import { acceptProposals, getRosterActor, proposalToken, setEmployeeLink, type RosterActor } from "@/lib/repLinks";
import { GET as searchRoute } from "@/app/api/rep-directory/search/route";
import { POST as linkRoute } from "@/app/api/rep-directory/link/route";
import { GET as rosterSearchRoute } from "@/app/api/rep-directory/roster-search/route";

const admin: RosterActor = { email: "admin@x.ke", isAdmin: true, teamLeaderId: null };
const tl: RosterActor = { email: "tl@x.ke", isAdmin: false, teamLeaderId: "tl-1" };
const employee = (over: Record<string, unknown> = {}) => ({ employeeCode: "E1", pineName: "Jane W", sapName: "Jane W", sapSlpCode: null, pineUserId: null, ...over });
const entry = (over: Record<string, unknown> = {}) => ({ source: "SAP", sourceKey: "101", displayName: "Jane Wanjiru", ...over });

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.employeeRepLink.findUnique.mockResolvedValue(null);
  prismaMock.employeeRepLink.findMany.mockResolvedValue([]);
  prismaMock.teamLeaderAssignment.findFirst.mockResolvedValue({ id: "a1" });
});

describe("getRosterActor", () => {
  it("accepts admins and team leaders with a roster, and nobody else", async () => {
    authMock.mockResolvedValue({ user: { role: "ADMIN", email: "a@x.ke" } });
    expect(await getRosterActor()).toMatchObject({ isAdmin: true });
    authMock.mockResolvedValue({ user: { role: "TEAM_LEADER", email: "t@x.ke", teamLeaderId: "tl-1" } });
    expect(await getRosterActor()).toMatchObject({ isAdmin: false, teamLeaderId: "tl-1" });
    authMock.mockResolvedValue({ user: { role: "TEAM_LEADER", email: "t@x.ke" } });
    expect(await getRosterActor()).toBeNull();
    authMock.mockResolvedValue({ user: { role: "REP", email: "r@x.ke" } });
    expect(await getRosterActor()).toBeNull();
    authMock.mockResolvedValue(null);
    expect(await getRosterActor()).toBeNull();
  });
});

describe("setEmployeeLink", () => {
  it("links a SAP rep: writes the identity's spelling and code to the employee and their assignments, and logs it", async () => {
    prismaMock.employeeMaster.findUnique.mockResolvedValue(employee());
    prismaMock.repDirectoryEntry.findUnique.mockResolvedValue(entry());
    const result = await setEmployeeLink({ employeeCode: "E1", source: "SAP", sourceKey: "101", actor: admin });
    expect(result).toMatchObject({ ok: true, changed: true, nameChanged: true, identityName: "Jane Wanjiru", sharedWith: [] });
    expect(prismaMock.employeeRepLink.upsert.mock.calls[0][0]).toMatchObject({ create: { employeeCode: "E1", source: "SAP", sourceKey: "101", linkedBy: "admin@x.ke" } });
    expect(prismaMock.employeeMaster.update).toHaveBeenCalledWith({ where: { employeeCode: "E1" }, data: { sapName: "Jane Wanjiru", sapSlpCode: 101 } });
    expect(prismaMock.teamLeaderAssignment.updateMany).toHaveBeenCalledWith({ where: { employeeCode: "E1" }, data: { sapName: "Jane Wanjiru" } });
    expect(prismaMock.employeeRepLinkChange.create.mock.calls[0][0].data).toMatchObject({ employeeCode: "E1", source: "SAP", action: "LINK", toKey: "101", toName: "Jane Wanjiru", changedBy: "admin@x.ke" });
  });

  it("links a Pine rep by writing the Pine name and user id, not the SAP columns", async () => {
    prismaMock.employeeMaster.findUnique.mockResolvedValue(employee({ employeeCode: "1249", pineName: "Robert M" }));
    prismaMock.repDirectoryEntry.findUnique.mockResolvedValue(entry({ source: "PINE", sourceKey: "1249", displayName: "Robert Macharia" }));
    await setEmployeeLink({ employeeCode: "1249", source: "PINE", sourceKey: "1249", actor: admin });
    expect(prismaMock.employeeMaster.update).toHaveBeenCalledWith({ where: { employeeCode: "1249" }, data: { pineName: "Robert Macharia", pineUserId: 1249 } });
    expect(prismaMock.teamLeaderAssignment.updateMany).toHaveBeenCalledWith({ where: { employeeCode: "1249" }, data: { employeeName: "Robert Macharia" } });
  });

  it("links a derived source without touching the employee's name columns", async () => {
    prismaMock.employeeMaster.findUnique.mockResolvedValue(employee());
    prismaMock.repDirectoryEntry.findUnique.mockResolvedValue(entry({ source: "LEVERAGE", sourceKey: "NAIROBI|R1", displayName: "Jane Wanjiru" }));
    const result = await setEmployeeLink({ employeeCode: "E1", source: "LEVERAGE", sourceKey: "NAIROBI|R1", actor: admin });
    expect(result).toMatchObject({ ok: true, changed: true, nameChanged: false });
    expect(prismaMock.employeeMaster.update).not.toHaveBeenCalled();
    expect(prismaMock.teamLeaderAssignment.updateMany).not.toHaveBeenCalled();
  });

  it("allows a second employee on the same identity and reports who else holds it", async () => {
    prismaMock.employeeMaster.findUnique.mockResolvedValue(employee({ employeeCode: "E4", pineName: "Jane W 2" }));
    prismaMock.repDirectoryEntry.findUnique.mockResolvedValue(entry());
    prismaMock.employeeRepLink.findMany.mockResolvedValue([{ employeeCode: "E1", employee: { pineName: "Jane W" } }]);
    const result = await setEmployeeLink({ employeeCode: "E4", source: "SAP", sourceKey: "101", actor: admin });
    expect(result).toMatchObject({ ok: true, changed: true, sharedWith: [{ employeeCode: "E1", name: "Jane W" }] });
  });

  it("logs a re-link with the old and new identity", async () => {
    prismaMock.employeeMaster.findUnique.mockResolvedValue(employee({ sapName: "Old Name", sapSlpCode: 7 }));
    prismaMock.employeeRepLink.findUnique.mockResolvedValue({ id: "l1", employeeCode: "E1", source: "SAP", sourceKey: "7" });
    prismaMock.repDirectoryEntry.findUnique.mockImplementation(async ({ where }: { where: { source_sourceKey: { sourceKey: string } } }) => (where.source_sourceKey.sourceKey === "7" ? entry({ sourceKey: "7", displayName: "Old Name" }) : entry()));
    await setEmployeeLink({ employeeCode: "E1", source: "SAP", sourceKey: "101", actor: admin });
    expect(prismaMock.employeeRepLinkChange.create.mock.calls[0][0].data).toMatchObject({ action: "RELINK", fromKey: "7", fromName: "Old Name", toKey: "101", toName: "Jane Wanjiru" });
  });

  it("does nothing, and logs nothing, when the link and the text are already right", async () => {
    prismaMock.employeeMaster.findUnique.mockResolvedValue(employee({ sapName: "Jane Wanjiru", sapSlpCode: 101 }));
    prismaMock.employeeRepLink.findUnique.mockResolvedValue({ id: "l1", employeeCode: "E1", source: "SAP", sourceKey: "101" });
    prismaMock.repDirectoryEntry.findUnique.mockResolvedValue(entry());
    const result = await setEmployeeLink({ employeeCode: "E1", source: "SAP", sourceKey: "101", actor: admin });
    expect(result).toMatchObject({ ok: true, changed: false, nameChanged: false });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("removes a link, clears the code but keeps the name as text, and logs it", async () => {
    prismaMock.employeeMaster.findUnique.mockResolvedValue(employee({ sapName: "Jane Wanjiru", sapSlpCode: 101 }));
    prismaMock.employeeRepLink.findUnique.mockResolvedValue({ id: "l1", employeeCode: "E1", source: "SAP", sourceKey: "101" });
    prismaMock.repDirectoryEntry.findUnique.mockResolvedValue({ displayName: "Jane Wanjiru" });
    const result = await setEmployeeLink({ employeeCode: "E1", source: "SAP", sourceKey: null, actor: admin });
    expect(result).toMatchObject({ ok: true, changed: true, nameChanged: false });
    expect(prismaMock.employeeRepLink.delete).toHaveBeenCalledWith({ where: { id: "l1" } });
    expect(prismaMock.employeeMaster.update).toHaveBeenCalledWith({ where: { employeeCode: "E1" }, data: { sapSlpCode: null } });
    expect(prismaMock.employeeRepLinkChange.create.mock.calls[0][0].data).toMatchObject({ action: "UNLINK", fromKey: "101", fromName: "Jane Wanjiru" });
  });

  it("lets a team leader change only reps on their own roster", async () => {
    prismaMock.employeeMaster.findUnique.mockResolvedValue(employee());
    prismaMock.repDirectoryEntry.findUnique.mockResolvedValue(entry());
    prismaMock.teamLeaderAssignment.findFirst.mockResolvedValue(null);
    const refused = await setEmployeeLink({ employeeCode: "E1", source: "SAP", sourceKey: "101", actor: tl });
    expect(refused).toMatchObject({ ok: false });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    prismaMock.teamLeaderAssignment.findFirst.mockResolvedValue({ id: "a1" });
    expect(await setEmployeeLink({ employeeCode: "E1", source: "SAP", sourceKey: "101", actor: tl })).toMatchObject({ ok: true });
    expect(prismaMock.teamLeaderAssignment.findFirst).toHaveBeenLastCalledWith({ where: { teamLeaderId: "tl-1", employeeCode: "E1" }, select: { id: true } });
  });

  it("refuses an identity that is not in the directory, an unknown employee and an unknown source", async () => {
    prismaMock.employeeMaster.findUnique.mockResolvedValue(employee());
    prismaMock.repDirectoryEntry.findUnique.mockResolvedValue(null);
    expect(await setEmployeeLink({ employeeCode: "E1", source: "SAP", sourceKey: "999", actor: admin })).toMatchObject({ ok: false });
    prismaMock.employeeMaster.findUnique.mockResolvedValue(null);
    expect(await setEmployeeLink({ employeeCode: "NOPE", source: "SAP", sourceKey: "101", actor: admin })).toMatchObject({ ok: false });
    expect(await setEmployeeLink({ employeeCode: "E1", source: "BOGUS" as never, sourceKey: "1", actor: admin })).toMatchObject({ ok: false });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});

describe("acceptProposals", () => {
  const setup = () => {
    prismaMock.employeeMaster.findMany.mockResolvedValue([
      { employeeCode: "E1", pineName: "Jane Wanjiru", sapName: "Jane Wanjiru", active: true },
      { employeeCode: "E2", pineName: "Peter Kamau", sapName: "Peter Kamau", active: true },
    ]);
    prismaMock.employeeRepLink.findMany.mockResolvedValue([]);
    prismaMock.repDirectoryEntry.findMany.mockResolvedValue([
      { source: "SAP", sourceKey: "101", displayName: "Jane Wanjiru", normalizedName: "jane wanjiru", isActive: true },
      { source: "SAP", sourceKey: "102", displayName: "Peter Kamau", normalizedName: "peter kamau", isActive: true },
    ]);
    prismaMock.employeeMaster.findUnique.mockImplementation(async ({ where }: { where: { employeeCode: string } }) => employee({ employeeCode: where.employeeCode }));
    prismaMock.repDirectoryEntry.findUnique.mockImplementation(async ({ where }: { where: { source_sourceKey: { sourceKey: string } } }) => ({ source: "SAP", sourceKey: where.source_sourceKey.sourceKey, displayName: where.source_sourceKey.sourceKey === "101" ? "Jane Wanjiru" : "Peter Kamau" }));
  };

  it("accepts only what is still a clean proposal today and counts the rest as skipped", async () => {
    setup();
    const good = proposalToken({ employeeCode: "E1", source: "SAP", sourceKey: "101" });
    const stale = proposalToken({ employeeCode: "E1", source: "SAP", sourceKey: "999" }); // not a proposal
    const result = await acceptProposals(admin, [good, stale]);
    expect(result).toMatchObject({ accepted: 1, skipped: 1, nameChanged: true });
    expect(prismaMock.employeeRepLinkChange.create.mock.calls[0][0].data).toMatchObject({ action: "ACCEPT_PROPOSAL", employeeCode: "E1", toKey: "101" });
  });

  it("limits a team leader to the reps on their own roster", async () => {
    setup();
    prismaMock.teamLeaderAssignment.findMany.mockResolvedValue([{ employeeCode: "E2" }]);
    const result = await acceptProposals(tl, [proposalToken({ employeeCode: "E1", source: "SAP", sourceKey: "101" }), proposalToken({ employeeCode: "E2", source: "SAP", sourceKey: "102" })]);
    expect(result).toMatchObject({ accepted: 1, skipped: 1 });
  });
});

describe("rep-directory API routes", () => {
  const post = (body: unknown) => linkRoute(new Request("http://x/api/rep-directory/link", { method: "POST", body: JSON.stringify(body) }) as never);
  const get = (route: (request: never) => Promise<Response>, query: string) => route({ nextUrl: new URL(`http://x/api?${query}`) } as never);

  it("refuses anyone who is not an admin or a team leader", async () => {
    authMock.mockResolvedValue({ user: { role: "REP" } });
    expect((await post({ employeeCode: "E1", source: "SAP", sourceKey: "101" })).status).toBe(401);
    expect((await get(searchRoute, "source=SAP&q=a")).status).toBe(401);
    expect((await get(rosterSearchRoute, "q=a")).status).toBe(401);
  });

  it("keeps the derived sources and the roster search to admins", async () => {
    authMock.mockResolvedValue({ user: { role: "TEAM_LEADER", email: "t@x.ke", teamLeaderId: "tl-1" } });
    expect((await post({ employeeCode: "E1", source: "LEVERAGE", sourceKey: "NAIROBI|R1" })).status).toBe(403);
    expect((await get(searchRoute, "source=DATAEDGE&q=a")).status).toBe(403);
    expect((await get(rosterSearchRoute, "q=a")).status).toBe(401);
  });

  it("validates the body", async () => {
    authMock.mockResolvedValue({ user: { role: "ADMIN", email: "a@x.ke" } });
    expect((await post({ source: "SAP", sourceKey: "1" })).status).toBe(400);
    expect((await post({ employeeCode: "E1", source: "NOPE", sourceKey: "1" })).status).toBe(400);
    expect((await post({ employeeCode: "E1", source: "SAP", sourceKey: 5 })).status).toBe(400);
    expect((await get(searchRoute, "source=NOPE")).status).toBe(400);
  });

  it("saves a link, runs the recompute once when the name changed, and returns the refreshed cells", async () => {
    authMock.mockResolvedValue({ user: { role: "ADMIN", email: "admin@x.ke" } });
    prismaMock.employeeMaster.findUnique.mockResolvedValue(employee());
    prismaMock.repDirectoryEntry.findUnique.mockResolvedValue(entry());
    prismaMock.employeeMaster.findMany.mockResolvedValue([]);
    prismaMock.repDirectoryEntry.findMany.mockResolvedValue([{ source: "SAP", sourceKey: "101", displayName: "Jane Wanjiru", normalizedName: "jane wanjiru", isActive: true }]);
    // This one mock serves both the shared-with query (reads employee.pineName) and the cell query (reads source and key).
    prismaMock.employeeRepLink.findMany.mockResolvedValue([{ employeeCode: "E1", source: "SAP", sourceKey: "101", employee: { pineName: "Jane W" } }]);
    const response = await post({ employeeCode: "E1", source: "SAP", sourceKey: "101" });
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data).toMatchObject({ ok: true, changed: true, cells: { sap: { state: "linked", key: "101", name: "Jane Wanjiru" } } });
    expect(recompute.contribution).toHaveBeenCalledTimes(1);
    expect(recompute.targets).toHaveBeenCalledTimes(1);
    expect(recompute.identities).toHaveBeenCalledTimes(1);
  });

  it("does not recompute when nothing about the name changed", async () => {
    authMock.mockResolvedValue({ user: { role: "ADMIN", email: "admin@x.ke" } });
    prismaMock.employeeMaster.findUnique.mockResolvedValue(employee({ sapName: "Jane Wanjiru", sapSlpCode: 101 }));
    prismaMock.employeeRepLink.findUnique.mockResolvedValue({ id: "l1", employeeCode: "E1", source: "SAP", sourceKey: "101" });
    prismaMock.repDirectoryEntry.findUnique.mockResolvedValue(entry());
    prismaMock.employeeMaster.findMany.mockResolvedValue([]);
    prismaMock.repDirectoryEntry.findMany.mockResolvedValue([]);
    await post({ employeeCode: "E1", source: "SAP", sourceKey: "101" });
    expect(recompute.contribution).not.toHaveBeenCalled();
  });
});
