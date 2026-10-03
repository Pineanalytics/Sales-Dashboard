import { describe, it, expect } from "vitest";
import { resolveSfaCustomer, sfaCustomerKey } from "../lib/sfaCustomer";

describe("resolveSfaCustomer", () => {
  it("uses the SFA name and pulls a trailing phone number out as the contact", () => {
    expect(resolveSfaCustomer("Hilaac Wholesalers Limited (Muhoho Ave) (+254729320233)", "HILAAC WHOLESALERS LIMITED")).toEqual({
      name: "Hilaac Wholesalers Limited (Muhoho Ave)",
      contact: "+254729320233",
      source: "SFA",
    });
    expect(resolveSfaCustomer("Daima Near Caro Mpesa (0733423510)", "Cash Customer-Kelly Kiprotich")).toMatchObject({
      name: "Daima Near Caro Mpesa",
      contact: "0733423510",
    });
  });

  it("keeps a non-phone trailing bracket as part of the name", () => {
    expect(resolveSfaCustomer("Country- Near Wa Marto( Ndandora)", "Cash Customer-Collins Onyuka")).toEqual({
      name: "Country- Near Wa Marto( Ndandora)",
      contact: "",
      source: "SFA",
    });
  });

  it("falls back to the account name when SFA left it blank or only a phone", () => {
    expect(resolveSfaCustomer(null, "Junior Wholesaler")).toEqual({ name: "Junior Wholesaler", contact: "", source: "ACCOUNT" });
    expect(resolveSfaCustomer("   ", "Junior Wholesaler").source).toBe("ACCOUNT");
    expect(resolveSfaCustomer("(+254726702151)", "ASTROL UTAWALA")).toEqual({
      name: "ASTROL UTAWALA",
      contact: "+254726702151",
      source: "ACCOUNT",
    });
  });

  it("labels a blank account too", () => {
    expect(resolveSfaCustomer(null, "").name).toBe("(Unknown Customer)");
  });
});

describe("sfaCustomerKey", () => {
  it("merges case and punctuation variants", () => {
    expect(sfaCustomerKey("M.G. Stores Ltd")).toBe(sfaCustomerKey("MG STORES LTD"));
  });
});
