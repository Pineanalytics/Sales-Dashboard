# Production governance

Production is defined by `origin/master`. Feature branches are review branches, not deployment sources.

Operational ownership, schedules, destinations, and release checks are kept in
[`automation-registry.md`](automation-registry.md) and
[`release-checklist.md`](release-checklist.md). Those documents apply whenever
a scheduler, integration endpoint, VPS configuration, or download-machine
artifact changes.

## Standard flow

1. Create a feature branch and commit one coherent change.
2. Open a pull request into `master` and require the **Validate master** check.
3. Merge only after type checking, tests, the production build, and the non-destructive schema check pass. Lint is reported but temporarily non-blocking because the reconciled codebase has pre-existing lint debt; make it blocking once that baseline is cleared.
4. Deploy the resulting `master` commit through **Deploy production**, or run `scripts/deploy.ps1` from a clean local `master` that exactly matches `origin/master`.
5. Verify `/api/health` reports the expected commit and review Dataset Management for source freshness.

## Deployment guarantees

- The deploy script rejects non-`master`, dirty, unpushed, or behind working trees.
- A VPS lock prevents two releases from changing production concurrently.
- The app and every code-bearing sync worker are rebuilt from the same Git archive.
- Images are tagged with the full commit SHA. The previous images are retained as `last-good` and restored automatically if the new health identity check fails.
- `/api/health` exposes the commit, branch, build time, and Prisma schema fingerprint running in production.

## Database changes

This database predates a reliable Prisma migration baseline. Until a reviewed baseline is introduced:

- Prefer expand/contract changes: add nullable structures, deploy compatible code, backfill, then remove obsolete structures only in a later reviewed release.
- `-PushSchema` first creates a production `pg_dump`, then runs `prisma db push` before application containers restart.
- `-AcceptDataLoss` is deliberately disabled.
- CI rejects schema diffs containing drops or truncation. A destructive migration requires its own reviewed migration and rollback plan; do not bypass the guard.

## Branch and worktree retirement

Before deleting a branch, verify both that its intended patch is represented in `master` and that its worktree is clean. Topological merge status alone is insufficient when a change was cherry-picked or reconciled.

The `add-upfield-visits-route` worktree currently contains an untracked `field-forms/` directory. Preserve or commit that directory before any cleanup. Branch deletion is intentionally separate from production deployment.
