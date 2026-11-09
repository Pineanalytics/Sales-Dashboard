import { describe, expect, it } from "vitest";
import { applyApprovedCleanup, applyShopDecisions, NO_APPROVED_CLEANUP, type ApprovedCleanup, type ApprovedEntry, type OverlayRow, type ShopRow } from "../lib/outletCleanup/overlay";

const row = (outletKey: string, principal = "Mars-Nairobi", extra: Partial<OverlayRow> = {}): OverlayRow => ({
  source: "PINE",
  outletKey,
  principal,
  region: "Nairobi",
  territory: "Kayole",
  channel: "Retail",
  segment: "Retailers",
  repCode: "100",
  repName: "Old Rep",
  teamLeader: "Eve Theuri",
  latitude: null,
  longitude: null,
  ...extra,
});

const entry = (outletKey: string, extra: Partial<ApprovedEntry> = {}): ApprovedEntry => ({
  id: `e-${outletKey}`,
  source: "PINE",
  outletKey,
  region: null,
  territory: null,
  channel: null,
  customerType: null,
  contactName: null,
  contactPhone: null,
  latitude: null,
  longitude: null,
  repDecisions: [],
  ...extra,
});

const approved = (parts: Partial<ApprovedCleanup>): ApprovedCleanup => ({ ...NO_APPROVED_CLEANUP, ...parts });

describe("approved cleanup laid over the universe", () => {
  it("replaces identification, GPS and contact on every row of the outlet, and leaves other outlets alone", () => {
    const rows = [row("1", "Mars-Nairobi"), row("1", "Suntory-Nairobi"), row("2")];
    const out = applyApprovedCleanup(rows, approved({ entries: [entry("1", { region: "Eastern", territory: "Kitui", channel: "Wholesale", customerType: "Wholesalers", contactName: "Mary Wanjiru", contactPhone: "+254712345678", latitude: -1.28, longitude: 36.9 })] }));
    for (const r of out.slice(0, 2)) expect(r).toMatchObject({ region: "Eastern", territory: "Kitui", channel: "Wholesale", segment: "Wholesalers", contactName: "Mary Wanjiru", contactPhone: "+254712345678", latitude: -1.28, longitude: 36.9 });
    expect(out[2]).toEqual(rows[2]);
    expect(rows[0].region).toBe("Nairobi"); // the input is not changed
  });

  it("changes the rep and the team leader only on the principal the decision names, and not for a confirmation", () => {
    const decisions: ApprovedEntry["repDecisions"] = [
      { principal: "mars-nairobi", rep: "New Rep", repCode: "200", previousRep: "Old Rep", action: "CHANGED" },
      { principal: "Suntory-Nairobi", rep: "Old Rep", repCode: "100", previousRep: "Old Rep", action: "CONFIRMED" },
    ];
    const out = applyApprovedCleanup([row("1", "Mars-Nairobi"), row("1", "Suntory-Nairobi")], approved({ entries: [entry("1", { repDecisions: decisions })], repTeamLeader: new Map([["200", "Clarrine Wahome"]]) }));
    expect(out[0]).toMatchObject({ repName: "New Rep", repCode: "200", teamLeader: "Clarrine Wahome" });
    expect(out[1]).toMatchObject({ repName: "Old Rep", repCode: "100", teamLeader: "Eve Theuri" });
  });

  it("moves the disowning team leader's rows to the claimant, or to nobody when closed, and leaves other teams' rows", () => {
    const rows = [row("1", "Mars-Nairobi"), row("1", "Weetabix-Nairobi", { teamLeader: "Nickley" })];
    const claimed = applyApprovedCleanup(rows, approved({ open: [{ source: "PINE", outletKey: "1", previousTeamLeader: "Eve  Theuri", status: "CLAIMED", claimedBy: "Emmy" }] }));
    expect(claimed.map((r) => r.teamLeader)).toEqual(["Emmy", "Nickley"]);
    const closed = applyApprovedCleanup(rows, approved({ open: [{ source: "PINE", outletKey: "1", previousTeamLeader: "Eve Theuri", status: "CLOSED", claimedBy: null }] }));
    expect(closed.map((r) => r.teamLeader)).toEqual([null, "Nickley"]);
  });

  it("is a no-op when nothing is approved", () => {
    const rows = [row("1")];
    expect(applyApprovedCleanup(rows, NO_APPROVED_CLEANUP)).toEqual(rows);
  });
});

describe("approved duplicate calls on the shops", () => {
  const shop = (outletKey: string, shopId: string, shopSize: number, extra: Partial<ShopRow> = {}): ShopRow => ({ source: "PINE", outletKey, shopId, shopSize, shopConfidence: shopSize > 1 ? "High" : null, territoryClean: "Kayole", ...extra });
  const dup = (a: string, b: string, decision: "MERGE" | "NOT_DUPLICATE") => ({ id: `${a}-${b}`, aSource: "PINE", aKey: a, bSource: "PINE", bKey: b, decision });
  const byKey = (rows: ShopRow[]) => Object.fromEntries(rows.map((r) => [r.outletKey, r]));

  it("joins two separate shops on a same-shop call, with the smaller id as master", () => {
    const out = byKey(applyShopDecisions([shop("1", "PINE-1", 1), shop("2", "PINE-2", 1), shop("3", "PINE-3", 1)], approved({ duplicates: [dup("2", "1", "MERGE")] })));
    expect(out["1"]).toMatchObject({ shopId: "PINE-1", shopSize: 2, shopConfidence: "Manual" });
    expect(out["2"]).toMatchObject({ shopId: "PINE-1", shopSize: 2, shopConfidence: "Manual" });
    expect(out["3"]).toMatchObject({ shopId: "PINE-3", shopSize: 1, shopConfidence: null });
  });

  it("takes the non-master outlet out of the shop on a not-a-duplicate call and resizes the shop", () => {
    const rows = [shop("1", "PINE-1", 3), shop("2", "PINE-1", 3), shop("3", "PINE-1", 3)];
    const out = byKey(applyShopDecisions(rows, approved({ duplicates: [dup("1", "2", "NOT_DUPLICATE")] })));
    expect(out["2"]).toMatchObject({ shopId: "PINE-2", shopSize: 1, shopConfidence: null });
    expect(out["1"]).toMatchObject({ shopId: "PINE-1", shopSize: 2 });
    expect(out["3"]).toMatchObject({ shopId: "PINE-1", shopSize: 2 });
  });

  it("separates both outlets when neither is the master", () => {
    const rows = [shop("1", "PINE-1", 3), shop("2", "PINE-1", 3), shop("3", "PINE-1", 3)];
    const out = byKey(applyShopDecisions(rows, approved({ duplicates: [dup("2", "3", "NOT_DUPLICATE")] })));
    expect(out["2"]).toMatchObject({ shopId: "PINE-2", shopSize: 1 });
    expect(out["3"]).toMatchObject({ shopId: "PINE-3", shopSize: 1 });
    expect(out["1"]).toMatchObject({ shopId: "PINE-1", shopSize: 1, shopConfidence: null });
  });

  it("keeps an approved territory as the unified name and leaves untouched rows as they are", () => {
    const rows = [shop("1", "PINE-1", 1, { territoryClean: "Kayole Soweto" }), shop("2", "PINE-2", 1)];
    const out = byKey(applyShopDecisions(rows, approved({ entries: [entry("1", { territory: "Kayole" })], duplicates: [dup("8", "9", "MERGE")] })));
    expect(out["1"].territoryClean).toBe("Kayole");
    expect(out["2"]).toEqual(rows[1]);
  });
});
