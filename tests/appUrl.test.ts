import { describe, expect, it } from "vitest";
import { canonicalAppUrl } from "../scripts/db-bridge/appUrl";

describe("canonicalAppUrl", () => {
  it("turns a www address into the apex host", () => {
    expect(canonicalAppUrl("https://www.pinefrostdb.com")).toBe("https://pinefrostdb.com");
    expect(canonicalAppUrl("https://www.pinefrostdb.com/")).toBe("https://pinefrostdb.com");
    expect(canonicalAppUrl("HTTPS://WWW.PINEFROSTDB.COM")).toBe("HTTPS://PINEFROSTDB.COM");
  });

  it("leaves the apex and other hosts alone, and trims spaces and trailing slashes", () => {
    expect(canonicalAppUrl(" https://pinefrostdb.com/ ")).toBe("https://pinefrostdb.com");
    expect(canonicalAppUrl("https://app.pinefrostdb.com")).toBe("https://app.pinefrostdb.com");
    expect(canonicalAppUrl("http://localhost:3000")).toBe("http://localhost:3000");
  });
});
