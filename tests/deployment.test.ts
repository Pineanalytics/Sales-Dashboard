import { describe, expect, it } from "vitest";
import { getDeploymentInfo } from "../lib/deployment";

describe("getDeploymentInfo", () => {
  it("returns explicit local fallbacks when build metadata is unavailable", () => {
    expect(getDeploymentInfo({})).toEqual({
      commit: "development",
      shortCommit: "development",
      branch: "local",
      builtAt: null,
      schemaFingerprint: "unavailable",
    });
  });

  it("exposes the immutable production build identity", () => {
    expect(
      getDeploymentInfo({
        APP_BUILD_COMMIT: "3b138133cf1d17de2a765ce16d6eb5c756557e48",
        APP_BUILD_BRANCH: "master",
        APP_BUILT_AT: "2026-08-29T06:00:00.000Z",
        APP_SCHEMA_FINGERPRINT: "abcdef1234567890",
      })
    ).toEqual({
      commit: "3b138133cf1d17de2a765ce16d6eb5c756557e48",
      shortCommit: "3b138133",
      branch: "master",
      builtAt: "2026-08-29T06:00:00.000Z",
      schemaFingerprint: "abcdef1234567890",
    });
  });
});
