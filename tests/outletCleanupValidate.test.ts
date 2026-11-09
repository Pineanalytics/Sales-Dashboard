import { describe, expect, it } from "vitest";
import { checkGeoTag, cleanContactName, haversineM, matchOption, normalizeKenyanPhone, planIdentification } from "../lib/outletCleanup/validate";
import type { CleanupOptions, IdentificationField } from "../lib/outletCleanup/types";

describe("contact details", () => {
  it("normalises Kenyan mobile numbers however they are typed", () => {
    for (const typed of ["0712345678", "0712 345 678", "+254712345678", "254712345678", "712345678", "07-12 345.678", "(0712) 345678"]) expect(normalizeKenyanPhone(typed)).toBe("+254712345678");
    expect(normalizeKenyanPhone("0112345678")).toBe("+254112345678");
  });

  it("rejects what is not a mobile number", () => {
    for (const typed of ["", "0212345678", "071234567", "07123456789", "abc", "+255712345678"]) expect(normalizeKenyanPhone(typed)).toBeNull();
  });

  it("accepts a plausible name and tidies its spacing", () => {
    expect(cleanContactName("  Mary   Wanjiru ")).toBe("Mary Wanjiru");
    expect(cleanContactName("O'Brien-Kamau Jr.")).toBe("O'Brien-Kamau Jr.");
    expect(["", "A", "12345", "Mary@shop", "x".repeat(61)].map(cleanContactName)).toEqual([null, null, null, null, null]);
  });
});

describe("choosing from a list", () => {
  const regions = ["Nairobi", "Mountain", "Eastern"];
  it("finds the option whatever the case or spacing, and nothing that is not on the list", () => {
    expect(matchOption("  nairobi ", regions)).toBe("Nairobi");
    expect(matchOption("EASTERN", regions)).toBe("Eastern");
    expect(matchOption("Nairobi West", regions)).toBeNull();
    expect(matchOption("", regions)).toBeNull();
  });
});

describe("tagging an outlet's location", () => {
  const none = { latitude: null, longitude: null };
  it("accepts an accurate point in Kenya", () => {
    expect(checkGeoTag({ latitude: -1.28, longitude: 36.9, accuracyM: 12 }, none)).toEqual({ ok: true, distanceM: null, farFromPrevious: false });
  });

  it("refuses a point outside Kenya, a zero point, an unreadable one and an inaccurate fix", () => {
    expect(checkGeoTag({ latitude: 51.5, longitude: -0.12, accuracyM: 5 }, none)).toMatchObject({ ok: false });
    expect(checkGeoTag({ latitude: 0, longitude: 0, accuracyM: 5 }, none)).toMatchObject({ ok: false });
    expect(checkGeoTag({ latitude: Number.NaN, longitude: 36.9, accuracyM: 5 }, none)).toMatchObject({ ok: false });
    const loose = checkGeoTag({ latitude: -1.28, longitude: 36.9, accuracyM: 250 }, none);
    expect(loose).toMatchObject({ ok: false });
    expect(loose.ok === false && loose.error).toMatch(/250 m/);
  });

  it("measures how far the new tag is from the point already held, and flags a big move", () => {
    const near = checkGeoTag({ latitude: -1.2801, longitude: 36.9, accuracyM: 10 }, { latitude: -1.28, longitude: 36.9 });
    expect(near).toMatchObject({ ok: true, farFromPrevious: false });
    const far = checkGeoTag({ latitude: -1.30, longitude: 36.9, accuracyM: 10 }, { latitude: -1.28, longitude: 36.9 });
    expect(far).toMatchObject({ ok: true, farFromPrevious: true });
    expect(haversineM(-1.28, 36.9, -1.30, 36.9)).toBeGreaterThan(2000);
  });
});

describe("planning an identification update", () => {
  const options: CleanupOptions = { regions: ["Nairobi", "Mountain", "Eastern"], territories: ["Kayole", "Utawala", "Kitui"], channels: ["Retail", "Wholesale"], customerTypes: ["Retailers", "Wholesalers", "Minimart"] };
  const current: Record<IdentificationField, string> = { region: "Nairobi", territory: "Kayole", channel: "Retail", customerType: "Retailers", contactName: "", contactPhone: "" };
  const base = { current, verified: {}, locked: [] as never[], options, canUnlock: false };

  it("stores only what differs from the universe, and locks every field it settles", () => {
    const plan = planIdentification({ ...base, request: { set: { region: "Eastern", territory: "kayole" } } });
    expect(plan.errors).toEqual([]);
    expect(plan.values).toEqual({ region: "Eastern" }); // territory is the same as it was: a confirmation
    expect(plan.lock.sort()).toEqual(["region", "territory"]);
  });

  it("refuses a value that is not on the list, a bad phone and a bad name", () => {
    const plan = planIdentification({ ...base, request: { set: { territory: "Kayole Soweto", contactPhone: "123", contactName: "12" } } });
    expect(plan.values).toEqual({});
    expect(plan.errors.map((e) => e.field).sort()).toEqual(["contactName", "contactPhone", "territory"]);
  });

  it("normalises a phone and a name it accepts", () => {
    const plan = planIdentification({ ...base, request: { set: { contactPhone: "0712 345 678", contactName: "  mary  wanjiru" } } });
    expect(plan.values).toEqual({ contactPhone: "+254712345678", contactName: "mary wanjiru" });
  });

  it("marks everything correct that has a value, and leaves the optional contacts alone", () => {
    const plan = planIdentification({ ...base, request: { confirm: "ALL" } });
    expect(plan.errors).toEqual([]);
    expect(plan.lock.sort()).toEqual(["channel", "customerType", "region", "territory"]);
  });

  it("refuses to change a locked field unless the person may reopen it", () => {
    const locked = planIdentification({ ...base, locked: ["region"], verified: { region: "Eastern" }, request: { set: { region: "Mountain" } } });
    expect(locked.values).toEqual({});
    expect(locked.errors[0]).toMatchObject({ field: "region" });
    expect(locked.errors[0].message).toMatch(/locked/);
    const allowed = planIdentification({ ...base, locked: ["region"], verified: { region: "Eastern" }, canUnlock: true, request: { set: { region: "Mountain" } } });
    expect(allowed.values).toEqual({ region: "Mountain" });
  });

  it("compares with what was verified, not only the universe", () => {
    const plan = planIdentification({ ...base, verified: { channel: "Wholesale" }, request: { set: { channel: "Wholesale" } } });
    expect(plan.values).toEqual({}); // already verified as Wholesale: nothing new, just a confirmation
    expect(plan.lock).toEqual(["channel"]);
  });

  it("cannot confirm an empty field", () => {
    const plan = planIdentification({ ...base, current: { ...current, territory: "" }, request: { confirm: ["territory"] } });
    expect(plan.errors[0]).toMatchObject({ field: "territory" });
  });
});
