<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Shared production deployment

The VPS and production Postgres are shared resources. Production may be
deployed only from a clean `master` commit that exactly matches
`origin/master`; `scripts/deploy.ps1` enforces this rule and serializes releases
with a VPS lock. Never deploy a feature branch or run an ad-hoc production
schema push.

Merge feature branches through `master`, run the validation suite, and use the
guarded production workflow or `scripts/deploy.ps1`. Schema changes must be
additive/expand-contract; `-AcceptDataLoss` is disabled. Read
`docs/production-governance.md` before deploying, changing Prisma, or retiring
a branch/worktree.

## Automation and multi-session coordination

For any production, integration, scheduler, VPS-environment, or download-machine
change, read `docs/automation-registry.md` and `docs/release-checklist.md`
before acting. Work in a dedicated feature branch and worktree; never share an
editable checkout with another active session. Before a deployment, fetch
`origin`, confirm the intended master commit and release scope, and use only
the clean deployment checkout at `D:\sales-dashboard-deploy-clean-20260831`.
Do not deploy unrelated master changes merely because they are present; stop
and request a release decision when the intended scope is unclear.
