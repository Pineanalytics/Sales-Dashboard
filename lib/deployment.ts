export interface DeploymentInfo {
  commit: string;
  shortCommit: string;
  branch: string;
  builtAt: string | null;
  schemaFingerprint: string;
}

/**
 * Build identity injected by scripts/deploy.ps1 through Docker build args.
 * Local development deliberately falls back to explicit non-production
 * values so health/admin surfaces never imply that an unknown build is live.
 */
type DeploymentEnvironment = Readonly<Record<string, string | undefined>>;

export function getDeploymentInfo(env: DeploymentEnvironment = process.env): DeploymentInfo {
  const commit = env.APP_BUILD_COMMIT?.trim() || "development";
  return {
    commit,
    shortCommit: commit === "development" ? commit : commit.slice(0, 8),
    branch: env.APP_BUILD_BRANCH?.trim() || "local",
    builtAt: env.APP_BUILT_AT?.trim() || null,
    schemaFingerprint: env.APP_SCHEMA_FINGERPRINT?.trim() || "unavailable",
  };
}
