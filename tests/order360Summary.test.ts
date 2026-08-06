import { describe, expect, it } from "vitest";
import type { OrderRecord } from "@prisma/client";
import {
  ageInDays,
  buildDeliveryDrivers,
  computeFunnel,
  computePendingBacklogs,
  dottedName,
  groupPerf,
  order360AgeBucket,
  resolveDriverName,
  returnTypeFor,
  vanDisplayName,
} from "../lib/order360Summary";

function makeOrder(overrides: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: overrides.erpNumber ?? "id",
    orderDate: new Date("2026-08-01T00:00:00.000Z"),
    erpNumber: "ERP-1",
    invoiceNumber: null,
    picklistId: null,
    customer: "Acme Ltd",
    fsr: "Jane Doe",
    amount: 1000,
    clearedBy: null,
    cleared: false,
    clearedDate: null,
    picker: null,
    picked: false,
    pickDate: null,
    dispatcher: null,
    dispatched: false,
    dispatchDate: null,
    auditedBy: null,
    audited: false,
    van: null,
    driver: null,
    deliveredBy: null,
    delivered: false,
    deliveryDate: null,
    isReturn: false,
    returnDocType: null,
    returnedBy: null,
    podStatus: null,
    stk: false,
    paymentRef: null,
    amountPaid: null,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("age bucket + age-in-days", () => {
  it("buckets 0-2 days as good, 3-7 as warn, 8+ as bad", () => {
    expect(order360AgeBucket(0)).toBe("good");
    expect(order360AgeBucket(2)).toBe("good");
    expect(order360AgeBucket(3)).toBe("warn");
    expect(order360AgeBucket(7)).toBe("warn");
    expect(order360AgeBucket(8)).toBe("bad");
  });

  it("computes whole calendar days between order date and today", () => {
    const orderDate = new Date("2026-08-01T23:00:00.000Z");
    const today = new Date("2026-08-04T01:00:00.000Z");
    expect(ageInDays(orderDate, today)).toBe(3);
  });
});

describe("funnel", () => {
  it("counts each stage flag independently, Invoiced always equal to total rows", () => {
    const rows = [
      makeOrder({ erpNumber: "1", cleared: true, picked: true, dispatched: true, audited: true, delivered: true }),
      makeOrder({ erpNumber: "2", cleared: true, picked: true, dispatched: true, audited: true, delivered: false }),
      makeOrder({ erpNumber: "3", cleared: true, picked: false }),
      makeOrder({ erpNumber: "4" }),
    ];
    expect(computeFunnel(rows)).toEqual([
      { stage: "Invoiced", count: 4 },
      { stage: "Cleared", count: 3 },
      { stage: "Picked", count: 2 },
      { stage: "Dispatched", count: 2 },
      { stage: "Audited", count: 2 },
      { stage: "Delivered", count: 1 },
    ]);
  });
});

describe("pending backlog (reached the prior gate, not yet this one)", () => {
  it("puts a never-cleared order only in the clearance backlog", () => {
    const rows = [makeOrder({ erpNumber: "1" })];
    const backlog = computePendingBacklogs(rows);
    expect(backlog.clearance).toHaveLength(1);
    expect(backlog.pick).toHaveLength(0);
    expect(backlog.dispatch).toHaveLength(0);
    expect(backlog.audit).toHaveLength(0);
    expect(backlog.delivery).toHaveLength(0);
  });

  it("puts a cleared-but-not-picked order only in the pick backlog", () => {
    const rows = [makeOrder({ erpNumber: "1", cleared: true })];
    const backlog = computePendingBacklogs(rows);
    expect(backlog.clearance).toHaveLength(0);
    expect(backlog.pick).toHaveLength(1);
  });

  it("puts a fully-audited-but-not-delivered order only in the delivery backlog", () => {
    const rows = [makeOrder({ erpNumber: "1", cleared: true, picked: true, dispatched: true, audited: true })];
    const backlog = computePendingBacklogs(rows);
    expect(backlog.audit).toHaveLength(0);
    expect(backlog.delivery).toHaveLength(1);
  });

  it("puts a fully delivered order in no backlog at all", () => {
    const rows = [makeOrder({ erpNumber: "1", cleared: true, picked: true, dispatched: true, audited: true, delivered: true })];
    const backlog = computePendingBacklogs(rows);
    expect(Object.values(backlog).every((list) => list.length === 0)).toBe(true);
  });
});

describe("perf leaderboards", () => {
  it("groups by dotted-lowercase name and sums orders/value, sorted by order count desc", () => {
    const rows = [
      makeOrder({ erpNumber: "1", clearedBy: "Mary David", amount: 100 }),
      makeOrder({ erpNumber: "2", clearedBy: "Mary David", amount: 50 }),
      makeOrder({ erpNumber: "3", clearedBy: "John Smith", amount: 900 }),
    ];
    expect(groupPerf(rows, "clearedBy")).toEqual([
      { name: "mary.david", orders: 2, value: 150 },
      { name: "john.smith", orders: 1, value: 900 },
    ]);
  });

  it("buckets a missing name as Unassigned", () => {
    const rows = [makeOrder({ erpNumber: "1", clearedBy: null })];
    expect(groupPerf(rows, "clearedBy")).toEqual([{ name: "Unassigned", orders: 1, value: 1000 }]);
  });
});

describe("dottedName / vanDisplayName", () => {
  it("lowercases and dot-joins a person's name", () => {
    expect(dottedName("Mary David")).toBe("mary.david");
    expect(dottedName("  Ian   Rotich  ")).toBe("ian.rotich");
  });

  it("combines a van reg with distinct driver first names", () => {
    expect(vanDisplayName("KDE 045L", ["Boaz Otieno"])).toBe("KDE 045L Boaz");
    expect(vanDisplayName("KDL 733D", ["Purity Wangombe", "Bosco Mwangi"])).toBe("KDL 733D Purity + Bosco");
  });

  it("dedupes same first name and falls back to the van alone with no drivers", () => {
    expect(vanDisplayName("KDL 733D", ["Purity Wangombe", "Purity K"])).toBe("KDL 733D Purity");
    expect(vanDisplayName("KDX 001A", [])).toBe("KDX 001A");
  });
});

describe("delivery driver leaderboard", () => {
  it("splits delivered vs pending per van and averages pending age", () => {
    const rows = [
      makeOrder({ erpNumber: "1", van: "KDE 045L", driver: "Boaz Otieno", delivered: true, amount: 500, amountPaid: 500 }),
      makeOrder({ erpNumber: "2", van: "KDE 045L", driver: "Boaz Otieno", cleared: true, picked: true, dispatched: true, audited: true, amount: 300, orderDate: new Date("2026-07-28T00:00:00.000Z") }),
    ];
    const pendingDelivery = computePendingBacklogs(rows).delivery;
    const now = new Date("2026-08-01T00:00:00.000Z");
    const drivers = buildDeliveryDrivers(rows, pendingDelivery, now);
    expect(drivers).toEqual([
      {
        name: "KDE 045L Boaz",
        deliveredOrders: 1,
        deliveredValue: 500,
        confirmedOrders: 1,
        unconfirmedOrders: 0,
        pendingOrders: 1,
        pendingValue: 300,
        avgAgePending: 4,
        maxAgePending: 4,
        returnsCount: 0,
        returnsValue: 0,
      },
    ]);
  });

  it("splits delivered orders into POD/payment-confirmed vs dispatched-only unconfirmed", () => {
    const rows = [
      makeOrder({ erpNumber: "1", van: "KDE 045L", driver: "Boaz Otieno", delivered: true, amount: 500, amountPaid: 500 }),
      makeOrder({ erpNumber: "2", van: "KDE 045L", driver: "Boaz Otieno", delivered: true, amount: 300, amountPaid: null }),
    ];
    const drivers = buildDeliveryDrivers(rows, [], new Date("2026-08-01T00:00:00.000Z"));
    expect(drivers[0].deliveredOrders).toBe(2);
    expect(drivers[0].confirmedOrders).toBe(1);
    expect(drivers[0].unconfirmedOrders).toBe(1);
  });

  it("prefers the curated deliveredBy directory name over the derived van/driver name", () => {
    const rows = [makeOrder({ erpNumber: "1", van: "KDE 045L", driver: "Boaz Otieno", deliveredBy: "Boaz - KDE 045L", delivered: true, amount: 500, amountPaid: 500 })];
    const drivers = buildDeliveryDrivers(rows, [], new Date("2026-08-01T00:00:00.000Z"));
    expect(drivers[0].name).toBe("Boaz - KDE 045L");
  });
});

describe("resolveDriverName", () => {
  it("uses the curated deliveredBy name when present", () => {
    expect(resolveDriverName({ deliveredBy: "Purity+Bosco - KDL 733D", van: "KDL 733D", driver: "Purity Wangombe" })).toBe("Purity+Bosco - KDL 733D");
  });

  it("falls back to the derived van/driver name when deliveredBy is null", () => {
    expect(resolveDriverName({ deliveredBy: null, van: "KDX 001A", driver: "New Guy" })).toBe("KDX 001A New");
  });
});

describe("return type classification", () => {
  it("marks a return as Full when it exactly reverses the matched original order", () => {
    const original = makeOrder({ erpNumber: "1", invoiceNumber: "INV-1", amount: 1000 });
    const fullReturn = makeOrder({ erpNumber: "2", invoiceNumber: "INV-1", isReturn: true, amount: -1000 });
    expect(returnTypeFor(fullReturn, [original, fullReturn])).toBe("Full");
  });

  it("marks a return as Partial when the amount doesn't fully match", () => {
    const original = makeOrder({ erpNumber: "1", invoiceNumber: "INV-1", amount: 1000 });
    const partialReturn = makeOrder({ erpNumber: "2", invoiceNumber: "INV-1", isReturn: true, amount: -400 });
    expect(returnTypeFor(partialReturn, [original, partialReturn])).toBe("Partial");
  });

  it("defaults to Partial when no original order can be matched", () => {
    const orphanReturn = makeOrder({ erpNumber: "2", invoiceNumber: "INV-9", isReturn: true, amount: -400 });
    expect(returnTypeFor(orphanReturn, [orphanReturn])).toBe("Partial");
  });
});
