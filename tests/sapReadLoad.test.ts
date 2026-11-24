import { describe, expect, it } from "vitest";
import { sapAppName, sapPoolConfig, type BridgeConfig } from "../scripts/db-bridge/sql";
import { canUseRunningBalance } from "../scripts/db-bridge/queries/stockBalance";

const config: BridgeConfig = { server: "sap", port: 1433, database: "GVS_PL_DB", user: "reader", password: "secret", encrypt: false, trustServerCertificate: true };

describe("how the dashboard reads the SAP server", () => {
  it("reads with READ UNCOMMITTED so a report never holds locks on, or waits for, a user's document", () => {
    // tedious' ISOLATION_LEVEL.READ_UNCOMMITTED is 1; READ_COMMITTED (the driver default) is 2.
    expect(sapPoolConfig(config).options).toMatchObject({ connectionIsolationLevel: 1 });
  });

  it("keeps the long request timeout and the connection settings it always had", () => {
    expect(sapPoolConfig(config)).toMatchObject({ server: "sap", port: 1433, database: "GVS_PL_DB", user: "reader", requestTimeout: 600_000, connectionTimeout: 30_000 });
    expect(sapPoolConfig(config).options).toMatchObject({ encrypt: false, trustServerCertificate: true });
  });

  it("names its sessions after the job, so a DBA can see which one is running", () => {
    expect(sapAppName("/app/scripts/db-bridge/stock-sync.ts")).toBe("pinefrost-sync:stock-sync");
    expect(sapAppName("/app/scripts/db-bridge/receivables/run.ts")).toBe("pinefrost-sync:receivables/run");
    expect(sapAppName("/app/scripts/db-bridge/sap-items/sync.ts")).toBe("pinefrost-sync:sap-items/sync");
    expect(sapAppName("")).toBe("pinefrost-sync");
    expect(sapPoolConfig(config, "pinefrost-sync:custom").options).toMatchObject({ appName: "pinefrost-sync:custom" });
  });
});

describe("the stock snapshot source", () => {
  const now = new Date("2026-11-24T08:30:00Z");

  it("uses SAP's running balance for today's snapshot, and the movement ledger for a past date", () => {
    expect(canUseRunningBalance(new Date("2026-11-24T05:00:00Z"), now)).toBe(true);
    expect(canUseRunningBalance(new Date("2026-11-25T00:00:00Z"), now)).toBe(true);
    expect(canUseRunningBalance(new Date("2026-11-23T23:59:00Z"), now)).toBe(false);
    expect(canUseRunningBalance(new Date("2026-06-30T12:00:00Z"), now)).toBe(false);
  });
});
