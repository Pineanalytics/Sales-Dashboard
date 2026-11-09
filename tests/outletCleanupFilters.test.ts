import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/db", () => ({ prisma: {} }));
vi.mock("../lib/outletCleanup/access", () => ({ inActorScope: () => true }));
vi.mock("../lib/outletCleanup/routingData", () => ({ loadRouting: async () => ({}) }));

import { parseQueueFilters } from "../lib/outletCleanup/data";

describe("outlet cleanup queue filters", () => {
  it("reads the rep and territory choices, trimmed, and treats blanks as no filter", () => {
    const filters = parseQueueFilters(new URLSearchParams({ rep: "  Ouma   Florence ", territory: "Kilimani", state: "all" }));
    expect(filters.rep).toBe("Ouma   Florence");
    expect(filters.territory).toBe("Kilimani");
    const blank = parseQueueFilters(new URLSearchParams({ rep: "  ", territory: "" }));
    expect(blank.rep).toBeNull();
    expect(blank.territory).toBeNull();
  });

  it("caps an oversized rep value", () => {
    expect(parseQueueFilters(new URLSearchParams({ rep: "x".repeat(500) })).rep).toHaveLength(100);
  });
});
