import { describe, expect, it } from "vitest";
import { order360ClearanceAssignment, order360ErpPrefix } from "../lib/order360Clearance";

describe("Order 360 ERP-prefix clearance allocation", () => {
  it("assigns each supplied ERP prefix to its principal accountant", () => {
    expect(order360ClearanceAssignment("8224822")).toMatchObject({ principal: "Upfield Nairobi", accountant: "Catherine Njeri" });
    expect(order360ClearanceAssignment("3104571")).toMatchObject({ principal: "Suntory-Nairobi", accountant: "Erick Yamina" });
    expect(order360ClearanceAssignment("ERP-70069239")).toMatchObject({ principal: "Ukl-Intl-Nairobi", accountant: "Catherine Njeri" });
  });

  it("uses the first three digits and leaves unmapped ERP numbers unassigned", () => {
    expect(order360ErpPrefix("ERP-18033046")).toBe("180");
    expect(order360ClearanceAssignment("7030001")).toBeNull();
  });
});
