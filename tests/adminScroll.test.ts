import { describe, it, expect } from "vitest";
import { parseSavedScroll, scrollToRestore, SCROLL_MAX_AGE_MS } from "../lib/adminScroll";

describe("parseSavedScroll", () => {
  it("parses a valid record and rejects junk", () => {
    expect(parseSavedScroll(JSON.stringify({ path: "/admin/products", y: 1200, at: 5 }))).toEqual({ path: "/admin/products", y: 1200, at: 5 });
    expect(parseSavedScroll(null)).toBeNull();
    expect(parseSavedScroll("not json")).toBeNull();
    expect(parseSavedScroll(JSON.stringify({ path: "/x", y: "12", at: 1 }))).toBeNull();
  });
});

describe("scrollToRestore", () => {
  const saved = { path: "/admin/products", y: 1500, at: 1_000 };

  it("restores for the same page shortly after the save", () => {
    expect(scrollToRestore(saved, "/admin/products", 1_000 + 2_000)).toBe(1500);
  });

  it("does not restore for another page or a stale record", () => {
    expect(scrollToRestore(saved, "/admin/users", 2_000)).toBeNull();
    expect(scrollToRestore(saved, "/admin/products", 1_000 + SCROLL_MAX_AGE_MS + 1)).toBeNull();
    expect(scrollToRestore(saved, "/admin/products", 500)).toBeNull();
  });

  it("ignores a saved position at the top of the page", () => {
    expect(scrollToRestore({ ...saved, y: 0 }, "/admin/products", 1_500)).toBeNull();
    expect(scrollToRestore(null, "/admin/products", 1_500)).toBeNull();
  });
});
