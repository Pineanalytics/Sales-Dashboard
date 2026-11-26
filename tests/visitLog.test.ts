import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({ $executeRaw: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));

import { fetchVisitLog, firstVisits, resolveVisitTimes, type VisitLogRow } from "@/scripts/db-bridge/timestamps/visitLog";
import { buildRepCalls } from "@/scripts/db-bridge/active-outlets/transform";
import type { OutletRow, UserRow } from "@/scripts/db-bridge/active-outlets/query";
import { POST } from "@/app/api/timestamps/upload/route";

let nextId = 0;
const row = (clock: string, userId = "u", date = "2026-11-25"): VisitLogRow => ({ id: ++nextId, userId, logged: `${date} ${clock}` });
const clockOf = (time: Date) => time.toISOString().slice(11, 19);

beforeEach(() => vi.clearAllMocks());

describe("working the 12-hour visit log back to 24 hours", () => {
  it("reads everything after the day's one step back as afternoon, 12:xx being noon", () => {
    // The clock a real day writes: nothing is ever stored after 12:59.
    const day = [row("05:20:27"), row("09:09:22"), row("11:59:21"), row("12:17:37", "v"), row("01:06:53", "v"), row("02:17:26"), row("05:04:40"), row("10:02:59")];
    expect(resolveVisitTimes(day).map((v) => clockOf(v.time))).toEqual(["05:20:27", "09:09:22", "11:59:21", "12:17:37", "13:06:53", "14:17:26", "17:04:40", "22:02:59"]);
  });

  it("finds the step from the order rows were written in, whatever order they arrive in", () => {
    const morning = row("09:00:00");
    const afternoon = row("02:00:00");
    expect(resolveVisitTimes([afternoon, morning]).map((v) => clockOf(v.time))).toEqual(["09:00:00", "14:00:00"]);
  });

  it("ignores rows a few moments out of order", () => {
    expect(resolveVisitTimes([row("09:00:05"), row("09:00:01"), row("09:30:00")]).map((v) => clockOf(v.time))).toEqual(["09:00:05", "09:00:01", "09:30:00"]);
  });

  it("reads a morning that is still being written as morning", () => {
    expect(resolveVisitTimes([row("06:15:56"), row("07:56:03")]).map((v) => clockOf(v.time))).toEqual(["06:15:56", "07:56:03"]);
  });

  it("leaves out a thin past day it cannot place, but keeps a busy one", () => {
    const thin = [row("08:30:28", "u", "2026-10-11"), row("07:00:00", "u", "2026-10-12")];
    expect(resolveVisitTimes(thin).map((v) => v.date)).toEqual(["2026-10-12"]);
    const busy = Array.from({ length: 20 }, (_, i) => row(`08:${String(i).padStart(2, "0")}:00`, "u", "2026-10-11"));
    expect(resolveVisitTimes([...busy, row("07:00:00", "u", "2026-10-12")])).toHaveLength(21);
  });
});

describe("first visits", () => {
  it("takes each rep's earliest from 6 AM, leaving out night-time app use", () => {
    const first = firstVisits([row("01:12:00"), row("05:59:59", "v"), row("06:00:00", "v"), row("09:09:22"), row("10:00:00"), row("02:00:00", "w")]);
    expect(clockOf(first.get("2026-11-25|u")!)).toBe("09:09:22");
    expect(clockOf(first.get("2026-11-25|v")!)).toBe("06:00:00");
    expect(clockOf(first.get("2026-11-25|w")!)).toBe("14:00:00");
  });
});

describe("the start of a rep's day", () => {
  const outlets = [{ id: "o", name: "Shop", subChannel: "Retailers", sourceChannel: "", territory: "Nairobi", latitude: null, longitude: null, pjpUserId: null, pjpRepName: null, pjpRepGroup: null, pjpRegion: null }] as OutletRow[];
  const users = [{ id: "u", employee: "Asha", userGroup: "DSR", region: "Nairobi" }] as UserRow[];
  const noSale = (clock: string) => ({ visitId: clock, visitTime: new Date(`2026-11-25T${clock}Z`), userId: "u", customerId: "o", noSaleReason: null });
  const build = (visit?: string) => buildRepCalls([], [noSale("10:40:53")], outlets, users, visit ? new Map([["2026-11-25|u", new Date(`2026-11-25T${visit}Z`)]]) : undefined)[0];

  it("moves back to an earlier first visit, with the hours to match and the call unchanged", () => {
    const call = build("09:10:53");
    expect(clockOf(call.firstCallOfDay)).toBe("09:10:53");
    expect(clockOf(call.lastCallOfDay)).toBe("10:40:53");
    expect(call.hoursInDay).toBe(1.5);
    expect(clockOf(call.callTime)).toBe("10:40:53");
    expect(call.callsInDay).toBe(1);
  });

  it("stays at the first record when the log has nothing earlier", () => {
    expect(clockOf(build().firstCallOfDay)).toBe("10:40:53");
    expect(clockOf(build("11:00:00").firstCallOfDay)).toBe("10:40:53");
  });
});

describe("reading the log from Pine", () => {
  const conn = (answers: unknown[][]) => {
    const query = vi.fn(async () => [answers.shift() ?? []]);
    return { query, conn: { query } as never };
  };

  it("reads from a recent id, stepping back until it reaches past the first day wanted", async () => {
    const { query, conn: connection } = conn([[{ id: 1_000_000 }], [{ day: "2026-11-25" }], [{ day: "2026-11-20" }], [{ id: 5, userId: 7, logged: "2026-11-25 09:00:00" }]]);
    expect(await fetchVisitLog(connection, "2026-11-25", "2026-11-27")).toEqual([{ id: 5, userId: "7", logged: "2026-11-25 09:00:00" }]);
    const calls = query.mock.calls as unknown as [string, unknown[]?][];
    expect(calls[1][1]).toEqual([960_000]);
    expect(calls[2][1]).toEqual([920_000]);
    expect(calls[3][1]).toEqual([920_000, "2026-11-25", "2026-11-27"]);
    for (const [sql] of calls) expect(sql.trim()).toMatch(/^SELECT/);
  });

  it("returns nothing for an empty log", async () => {
    expect(await fetchVisitLog(conn([[{ id: null }]]).conn, "2026-11-25", "2026-11-26")).toEqual([]);
  });
});

describe("the upload's day-start mode", () => {
  const send = (body: unknown) => {
    process.env.UPLOAD_API_KEY = "test-key";
    return POST(new Request("http://x/api/timestamps/upload", { method: "POST", headers: { "x-upload-api-key": "test-key" }, body: JSON.stringify(body) }) as never);
  };

  it("only moves saved starts earlier, sending the wall-clock time unconverted", async () => {
    prismaMock.$executeRaw.mockResolvedValue(3);
    const response = await send({ dayStarts: [{ date: "2026-11-25", employeeCode: "u", firstVisit: "2026-11-25T09:09:22.000Z" }] });
    expect(await response.json()).toEqual({ count: 1, updated: 3 });
    const [strings, values] = prismaMock.$executeRaw.mock.calls[0] as [string[], { values: unknown[] }];
    const sql = strings.join(" ");
    expect(sql).toContain('saved."firstCallOfDay" > counted.first_visit');
    expect(sql).not.toMatch(/DELETE|INSERT/);
    expect(values.values).toEqual(["2026-11-25", "u", "2026-11-25T09:09:22"]);
  });

  it("refuses a visit on another day or a malformed time", async () => {
    for (const firstVisit of ["2026-11-24T09:00:00.000Z", "2026-11-25", "2026-11-25T09:00:00+03:00"]) {
      expect((await send({ dayStarts: [{ date: "2026-11-25", employeeCode: "u", firstVisit }] })).status, firstVisit).toBe(400);
    }
    expect(prismaMock.$executeRaw).not.toHaveBeenCalled();
  });
});
