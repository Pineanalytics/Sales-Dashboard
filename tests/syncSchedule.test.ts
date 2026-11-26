import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  syncJobSchedule: { findMany: vi.fn(), upsert: vi.fn((args: unknown) => args) },
  $transaction: vi.fn(async (ops: unknown[]) => ops),
}));
const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { getDisabledJobs, getScheduleStates, pickDueJob, resolveScheduleJobs, setScheduledRuns } from "@/lib/syncSchedule";
import { SAP_SYNC_JOBS, SYNC_JOB_INFO, type SyncJobName } from "@/lib/syncJobs";
import { GET, POST } from "@/app/api/sync/schedule/route";
import { SapScheduleControl, ScheduleSwitch } from "@/components/admin/ScheduleSwitch";

const post = (body: unknown) => POST(new Request("http://x/api/sync/schedule", { method: "POST", body: JSON.stringify(body) }) as never);
const admin = { user: { role: "ADMIN", email: "admin@x.ke" } };

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue(admin);
});

describe("which jobs the SAP switch covers", () => {
  it("is every job that the SAP worker supervises, and nothing from Pine", () => {
    expect([...SAP_SYNC_JOBS].sort()).toEqual(["performance", "pl", "purchases", "receivables", "sales", "sales-lines", "sap-items", "sap-reps", "sfa-sales", "stock"]);
    for (const job of SAP_SYNC_JOBS) expect(SYNC_JOB_INFO[job].label).toBeTruthy();
  });
});

describe("resolveScheduleJobs", () => {
  it("accepts the SAP group, or a list of known jobs, and nothing else", () => {
    expect(resolveScheduleJobs({ group: "sap" })).toEqual({ ok: true, jobs: [...SAP_SYNC_JOBS] });
    expect(resolveScheduleJobs({ jobs: ["stock", "stock", "sales"] })).toEqual({ ok: true, jobs: ["stock", "sales"] });
    expect(resolveScheduleJobs({ group: "pine" }).ok).toBe(false);
    expect(resolveScheduleJobs({ jobs: [] }).ok).toBe(false);
    expect(resolveScheduleJobs({ jobs: ["stock", "drop table"] }).ok).toBe(false);
    expect(resolveScheduleJobs({}).ok).toBe(false);
  });
});

describe("setScheduledRuns", () => {
  it("switches every SAP job off in one transaction and records who did it", async () => {
    const outcome = await setScheduledRuns({ group: "sap", enabled: false }, "admin@x.ke");
    expect(outcome).toEqual({ ok: true, jobs: [...SAP_SYNC_JOBS], enabled: false });
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.syncJobSchedule.upsert).toHaveBeenCalledTimes(SAP_SYNC_JOBS.length);
    expect(prismaMock.syncJobSchedule.upsert).toHaveBeenCalledWith({ where: { job: "stock" }, create: { job: "stock", enabled: false, changedBy: "admin@x.ke" }, update: { enabled: false, changedBy: "admin@x.ke" } });
  });

  it("refuses a missing or non-boolean enabled flag and an unknown job without writing", async () => {
    expect(await setScheduledRuns({ group: "sap" }, null)).toMatchObject({ ok: false, status: 400 });
    expect(await setScheduledRuns({ group: "sap", enabled: "no" }, null)).toMatchObject({ ok: false, status: 400 });
    expect(await setScheduledRuns({ jobs: ["nope"], enabled: false }, null)).toMatchObject({ ok: false, status: 400 });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});

describe("reading the switches", () => {
  it("the worker gets only the jobs that are off, among the ones it supervises", async () => {
    prismaMock.syncJobSchedule.findMany.mockResolvedValue([{ job: "stock" }, { job: "not-a-job" }]);
    const off = await getDisabledJobs(["stock", "sales"]);
    expect([...off]).toEqual(["stock"]);
    expect(prismaMock.syncJobSchedule.findMany).toHaveBeenCalledWith({ where: { enabled: false, job: { in: ["stock", "sales"] } }, select: { job: true } });
  });

  it("the page gets every switched job with who changed it", async () => {
    const when = new Date("2026-11-25T10:00:00Z");
    prismaMock.syncJobSchedule.findMany.mockResolvedValue([{ job: "pl", enabled: false, changedBy: "a@x.ke", updatedAt: when }]);
    expect((await getScheduleStates()).get("pl")).toEqual({ enabled: false, changedBy: "a@x.ke", updatedAt: when });
  });
});

describe("pickDueJob (the worker's choice of what to run)", () => {
  const jobs = (["sales", "stock", "pl"] as SyncJobName[]).map((name) => ({ name }));
  const reschedule = () => 99_000;

  it("runs the first job that is due and ignores one that is not due yet", () => {
    const nextDue = new Map<SyncJobName, number>([["sales", 5_000], ["stock", 1_000], ["pl", 0]]);
    expect(pickDueJob(jobs, nextDue, 2_000, new Set(), reschedule).due?.name).toBe("stock");
  });

  it("never runs a switched-off job: it is moved to its next slot instead, as if it had run", () => {
    const nextDue = new Map<SyncJobName, number>([["sales", 0], ["stock", 0], ["pl", 0]]);
    const { due, skipped } = pickDueJob(jobs, nextDue, 1_000, new Set<SyncJobName>(["sales", "stock"]), reschedule);
    expect(due?.name).toBe("pl");
    expect(skipped.map((job) => job.name)).toEqual(["sales", "stock"]);
    expect(nextDue.get("sales")).toBe(99_000);
    expect(nextDue.get("stock")).toBe(99_000);
  });

  it("runs nothing at all when every job is off, including the run on start", () => {
    const nextDue = new Map<SyncJobName, number>([["sales", 0], ["stock", 0], ["pl", 0]]);
    const { due } = pickDueJob(jobs, nextDue, 1_000, new Set<SyncJobName>(["sales", "stock", "pl"]), reschedule);
    expect(due).toBeUndefined();
  });

  it("runs a job again once it is switched back on and its slot comes", () => {
    const nextDue = new Map<SyncJobName, number>([["sales", 99_000]]);
    expect(pickDueJob([{ name: "sales" as SyncJobName }], nextDue, 98_000, new Set(), reschedule).due).toBeUndefined();
    expect(pickDueJob([{ name: "sales" as SyncJobName }], nextDue, 99_000, new Set(), reschedule).due?.name).toBe("sales");
  });
});

describe("POST /api/sync/schedule", () => {
  it("is for signed-in admins only", async () => {
    authMock.mockResolvedValue(null);
    expect((await post({ group: "sap", enabled: false })).status).toBe(401);
    authMock.mockResolvedValue({ user: { role: "VIEWER" } });
    expect((await post({ group: "sap", enabled: false })).status).toBe(401);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a bad body and accepts a good one", async () => {
    expect((await post({ group: "sap" })).status).toBe(400);
    const ok = await post({ jobs: ["stock"], enabled: false });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ jobs: ["stock"], enabled: false });
  });

  it("GET lists the jobs that are off", async () => {
    prismaMock.syncJobSchedule.findMany.mockResolvedValue([{ job: "stock", enabled: false, changedBy: null, updatedAt: new Date() }, { job: "sales", enabled: true, changedBy: null, updatedAt: new Date() }]);
    const response = await GET();
    expect(await response.json()).toMatchObject({ off: ["stock"] });
  });
});

describe("the switch controls", () => {
  it("a job's switch says whether its scheduled runs are on or off", () => {
    expect(renderToString(createElement(ScheduleSwitch, { job: "stock", label: "Stock (SAP)", off: false }))).toContain("Scheduled runs on");
    const off = renderToString(createElement(ScheduleSwitch, { job: "stock", label: "Stock (SAP)", off: true }));
    expect(off).toContain("Scheduled runs off");
    expect(off).toContain('aria-checked="false"');
  });

  it("the SAP control describes the group and only offers the action that applies", () => {
    const allOn = renderToString(createElement(SapScheduleControl, { total: 9, off: 0 }));
    expect(allOn).toContain("All 9 are on");
    expect(allOn).toMatch(/Resume all SAP jobs/);
    const allOff = renderToString(createElement(SapScheduleControl, { total: 9, off: 9 }));
    expect(allOff).toContain("All 9 are paused");
    expect(renderToString(createElement(SapScheduleControl, { total: 9, off: 4 }))).toContain("5 on, 4 paused");
  });
});
