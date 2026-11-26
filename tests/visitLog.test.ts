import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({ $executeRaw: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));

import { fetchVisitLog, resolveVisitTimes, visitSpans, type VisitLogRow } from "@/scripts/db-bridge/timestamps/visitLog";
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

describe("first and last visits", () => {
  it("takes each rep's earliest and latest between 6 AM and 8 PM, leaving out night-time app use", () => {
    const spans = visitSpans([
      row("01:12:00"), row("05:59:59", "v"), row("06:00:00", "v"), row("09:09:22"), row("10:00:00"),
      row("12:00:00", "x"), row("02:00:00", "w"), row("05:04:40"), row("08:00:00", "v"), row("08:00:01"), row("10:02:59"),
    ]);
    const span = (user: string) => [clockOf(spans.get(`2026-11-25|${user}`)!.first), clockOf(spans.get(`2026-11-25|${user}`)!.last)];
    expect(span("u")).toEqual(["09:09:22", "17:04:40"]); // 8:00:01 PM and 10 PM are left out
    expect(span("v")).toEqual(["06:00:00", "20:00:00"]); // both ends count
    expect(span("w")).toEqual(["14:00:00", "14:00:00"]);
  });

  it("leaves out a rep whose only visits fall outside those hours", () => {
    expect(visitSpans([row("05:00:00"), row("12:30:00", "v"), row("09:00:00")]).has("2026-11-25|u")).toBe(false);
  });
});

describe("the start and close of a rep's day", () => {
  const outlets = [{ id: "o", name: "Shop", subChannel: "Retailers", sourceChannel: "", territory: "Nairobi", latitude: null, longitude: null, pjpUserId: null, pjpRepName: null, pjpRepGroup: null, pjpRegion: null }] as OutletRow[];
  const users = [{ id: "u", employee: "Asha", userGroup: "DSR", region: "Nairobi" }] as UserRow[];
  const at = (clock: string) => new Date(`2026-11-25T${clock}Z`);
  const noSale = { visitId: "n", visitTime: at("10:40:53"), userId: "u", customerId: "o", noSaleReason: null };
  const build = (visit?: [string, string]) =>
    buildRepCalls([], [noSale], outlets, users, visit ? new Map([["2026-11-25|u", { first: at(visit[0]), last: at(visit[1]) }]]) : undefined)[0];

  it("widens to the first and last visit, with the hours to match and the call unchanged", () => {
    const call = build(["09:10:53", "17:10:53"]);
    expect([clockOf(call.firstCallOfDay), clockOf(call.lastCallOfDay)]).toEqual(["09:10:53", "17:10:53"]);
    expect(call.hoursInDay).toBe(8);
    expect(clockOf(call.callTime)).toBe("10:40:53");
    expect(call.callsInDay).toBe(1);
  });

  it("keeps a record that is earlier or later than the visits", () => {
    expect(clockOf(build().firstCallOfDay)).toBe("10:40:53");
    expect(clockOf(build().lastCallOfDay)).toBe("10:40:53");
    const early = build(["09:00:00", "10:00:00"]);
    expect([clockOf(early.firstCallOfDay), clockOf(early.lastCallOfDay)]).toEqual(["09:00:00", "10:40:53"]);
    const late = build(["11:00:00", "12:00:00"]);
    expect([clockOf(late.firstCallOfDay), clockOf(late.lastCallOfDay)]).toEqual(["10:40:53", "12:00:00"]);
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

describe("the upload's day-visit mode", () => {
  const send = (body: unknown) => {
    process.env.UPLOAD_API_KEY = "test-key";
    return POST(new Request("http://x/api/timestamps/upload", { method: "POST", headers: { "x-upload-api-key": "test-key" }, body: JSON.stringify(body) }) as never);
  };

  it("only widens saved days, sending the wall-clock times unconverted", async () => {
    prismaMock.$executeRaw.mockResolvedValue(3);
    const response = await send({ dayVisits: [{ date: "2026-11-25", employeeCode: "u", firstVisit: "2026-11-25T09:09:22.000Z", lastVisit: "2026-11-25T17:04:40.000Z" }] });
    expect(await response.json()).toEqual({ count: 1, updated: 3 });
    const [strings, values] = prismaMock.$executeRaw.mock.calls[0] as [string[], { values: unknown[] }];
    const sql = strings.join(" ");
    expect(sql).toContain('LEAST(saved."firstCallOfDay", counted.first_visit)');
    expect(sql).toContain('GREATEST(saved."lastCallOfDay", counted.last_visit)');
    expect(sql).not.toMatch(/DELETE|INSERT/);
    expect(values.values).toEqual(["2026-11-25", "u", "2026-11-25T09:09:22", "2026-11-25T17:04:40"]);
  });

  it("refuses a visit on another day, a malformed time or a close before the start", async () => {
    const good = { date: "2026-11-25", employeeCode: "u", firstVisit: "2026-11-25T09:00:00.000Z", lastVisit: "2026-11-25T17:00:00.000Z" };
    for (const bad of [
      { firstVisit: "2026-11-24T09:00:00.000Z" },
      { lastVisit: "2026-11-26T09:00:00.000Z" },
      { firstVisit: "2026-11-25" },
      { lastVisit: "2026-11-25T17:00:00+03:00" },
      { lastVisit: undefined },
      { lastVisit: "2026-11-25T08:00:00.000Z" },
    ]) {
      expect((await send({ dayVisits: [{ ...good, ...bad }] })).status, JSON.stringify(bad)).toBe(400);
    }
    expect(prismaMock.$executeRaw).not.toHaveBeenCalled();
  });
});
