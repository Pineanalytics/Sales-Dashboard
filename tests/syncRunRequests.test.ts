import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  syncRunRequest: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  syncJobStatus: { findMany: vi.fn(), upsert: vi.fn() },
  $queryRaw: vi.fn(),
}));
const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/auth", () => ({ auth: authMock }));

import { claimSyncRequest, failOrphanedSyncRequests, finishSyncRequest, recordSyncJobRun, requestSyncRun } from "@/lib/syncRunRequests";
import { isSyncJobName, SYNC_JOB_INFO, SYNC_JOB_NAMES } from "@/lib/syncJobs";
import { GET, POST } from "@/app/api/sync/run/route";

const row = (over: Record<string, unknown> = {}) => ({ id: "r1", job: "sales", status: "PENDING", requestedBy: "a@x.ke", requestedAt: new Date(), startedAt: null, completedAt: null, resultSummary: null, ...over });
const post = (body: unknown) => POST(new Request("http://x/api/sync/run", { method: "POST", body: JSON.stringify(body) }) as never);
const get = (job: string) => GET({ nextUrl: new URL(`http://x/api/sync/run?job=${job}`) } as never);

beforeEach(() => vi.clearAllMocks());

describe("sync job list", () => {
  it("has a label for every job and recognises only real job names", () => {
    for (const job of SYNC_JOB_NAMES) expect(SYNC_JOB_INFO[job].label.length).toBeGreaterThan(3);
    expect(isSyncJobName("sales")).toBe(true);
    expect(isSyncJobName("drop table")).toBe(false);
    expect(isSyncJobName(undefined)).toBe(false);
  });
});

describe("requestSyncRun", () => {
  it("rejects a job name that is not in the list without touching the database", async () => {
    const outcome = await requestSyncRun("rm -rf", "a@x.ke");
    expect(outcome).toMatchObject({ ok: false, status: 400 });
    expect(prismaMock.syncRunRequest.create).not.toHaveBeenCalled();
  });

  it("queues a new request when none is waiting or running", async () => {
    prismaMock.syncRunRequest.findFirst.mockResolvedValue(null);
    prismaMock.syncRunRequest.create.mockResolvedValue(row());
    const outcome = await requestSyncRun("sales", "a@x.ke");
    expect(prismaMock.syncRunRequest.create).toHaveBeenCalledWith({ data: { job: "sales", requestedBy: "a@x.ke" } });
    expect(outcome).toMatchObject({ ok: true, alreadyActive: false });
  });

  it("reuses a request already queued or running, so a double click cannot stack two runs", async () => {
    prismaMock.syncRunRequest.findFirst.mockResolvedValue(row({ status: "RUNNING" }));
    const outcome = await requestSyncRun("sales", "a@x.ke");
    expect(prismaMock.syncRunRequest.create).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ ok: true, alreadyActive: true });
    const where = prismaMock.syncRunRequest.findFirst.mock.calls[0][0].where;
    expect(where.status).toEqual({ in: ["PENDING", "RUNNING"] });
  });
});

describe("worker side", () => {
  it("claims nothing, and asks nothing, when the worker has no jobs", async () => {
    expect(await claimSyncRequest([])).toBeNull();
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
  });

  it("returns the claimed request, and ignores a row whose job it does not know", async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([{ id: "r1", job: "stock" }]);
    expect(await claimSyncRequest(["sales", "stock"])).toEqual({ id: "r1", job: "stock" });
    prismaMock.$queryRaw.mockResolvedValueOnce([{ id: "r2", job: "mystery" }]);
    expect(await claimSyncRequest(["sales"])).toBeNull();
    prismaMock.$queryRaw.mockResolvedValueOnce([]);
    expect(await claimSyncRequest(["sales"])).toBeNull();
  });

  it("marks a finished request completed or failed and truncates a long error", async () => {
    await finishSyncRequest("r1", true, "Completed in 41s.");
    expect(prismaMock.syncRunRequest.update.mock.calls[0][0].data).toMatchObject({ status: "COMPLETED", resultSummary: "Completed in 41s." });
    await finishSyncRequest("r1", false, "x".repeat(900));
    const failed = prismaMock.syncRunRequest.update.mock.calls[1][0].data;
    expect(failed.status).toBe("FAILED");
    expect(failed.resultSummary).toHaveLength(500);
  });

  it("fails requests the previous worker process left RUNNING, only for its own jobs", async () => {
    prismaMock.syncRunRequest.updateMany.mockResolvedValue({ count: 2 });
    expect(await failOrphanedSyncRequests(["sales", "pl"])).toBe(2);
    expect(prismaMock.syncRunRequest.updateMany.mock.calls[0][0].where).toEqual({ job: { in: ["sales", "pl"] }, status: "RUNNING" });
  });

  it("records a success with its time, and a failure without moving the last-success time", async () => {
    const startedAt = new Date("2026-11-12T10:00:00Z");
    const finishedAt = new Date("2026-11-12T10:00:42Z");
    await recordSyncJobRun("sales", { startedAt, finishedAt, ok: true });
    const success = prismaMock.syncJobStatus.upsert.mock.calls[0][0];
    expect(success.update).toMatchObject({ lastOk: true, lastSuccessAt: finishedAt, lastError: null, lastDurationMs: 42_000 });
    await recordSyncJobRun("sales", { startedAt, finishedAt, ok: false, error: "Could not connect to 127.0.0.1:14333" });
    const failure = prismaMock.syncJobStatus.upsert.mock.calls[1][0];
    expect(failure.update).toMatchObject({ lastOk: false, lastError: "Could not connect to 127.0.0.1:14333" });
    expect(failure.update).not.toHaveProperty("lastSuccessAt");
    expect(failure.create.lastSuccessAt).toBeNull();
  });
});

describe("POST/GET /api/sync/run", () => {
  it("refuses anyone who is not an admin", async () => {
    authMock.mockResolvedValue({ user: { role: "TEAM_LEADER", email: "t@x.ke" } });
    expect((await post({ job: "sales" })).status).toBe(401);
    expect((await get("sales")).status).toBe(401);
    authMock.mockResolvedValue(null);
    expect((await post({ job: "sales" })).status).toBe(401);
    expect(prismaMock.syncRunRequest.create).not.toHaveBeenCalled();
  });

  it("queues a run for an admin and answers 202, or 400 for an unknown job", async () => {
    authMock.mockResolvedValue({ user: { role: "ADMIN", email: "admin@x.ke" } });
    prismaMock.syncRunRequest.findFirst.mockResolvedValue(null);
    prismaMock.syncRunRequest.create.mockResolvedValue(row());
    const queued = await post({ job: "sales" });
    expect(queued.status).toBe(202);
    expect(prismaMock.syncRunRequest.create).toHaveBeenCalledWith({ data: { job: "sales", requestedBy: "admin@x.ke" } });
    expect((await post({ job: "nope" })).status).toBe(400);
  });

  it("reports progress of the newest request, flagging one nobody has picked up", async () => {
    authMock.mockResolvedValue({ user: { role: "ADMIN", email: "admin@x.ke" } });
    prismaMock.syncRunRequest.findFirst.mockResolvedValueOnce(row({ status: "PENDING", requestedAt: new Date(Date.now() - 10 * 60_000) }));
    const stuck = await (await get("sales")).json();
    expect(stuck.unclaimed).toBe(true);
    prismaMock.syncRunRequest.findFirst.mockResolvedValueOnce(row({ status: "RUNNING" }));
    const running = await (await get("sales")).json();
    expect(running.request.status).toBe("RUNNING");
    expect(running.unclaimed).toBe(false);
    expect((await get("bogus")).status).toBe(400);
  });
});
