<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Shared production deploy — one slot, multiple branches (read before deploying or pushing schema)

This repo has had active work on more than one branch at once (`master` plus
feature branches such as `codex/pjp-ownership-adherence`), but `scripts/deploy.ps1`
and its `-PushSchema` flag both target **one single shared VPS and one single
Postgres database**, regardless of which branch/worktree you run them from.
Neither is additive — a code deploy *fully replaces* `/opt/pinefrost` with
whatever branch's HEAD you deployed, and a schema push reconciles the live
database to exactly match whatever `prisma/schema.prisma` you're pushing.
This already caused one real incident (2026-08-28: an unmerged branch's live
tables nearly got dropped, then that same branch's already-live application
code got silently wiped by a different branch's deploy) — both parts are
easy to avoid with two checks:

**Before running `-PushSchema` from any branch:**
```
git diff <your-branch> origin/<other-active-branch> -- prisma/schema.prisma
```
If this shows anything beyond your own pending change, reconcile
`prisma/schema.prisma` to be a superset first (copy the other branch's
models/columns in as-is) — never pass `--accept-data-loss` on a table/column
with non-zero rows without explicit human confirmation, regardless of which
branch "owns" it.

**Before running `deploy.ps1` (code) from any branch:**
```
git log <your-branch>..origin/<other-active-branch> --oneline
```
If this shows commits, deploying `<your-branch>` now will remove that other
branch's code from production. The fix is to merge first, not to deploy
around it: `git checkout <other-branch> && git merge origin/master` (merge,
not rebase, if the branch is already pushed/shared), verify with
`prisma generate` + `next typegen` (needed before `tsc --noEmit`, otherwise
generated Next.js route types like `RouteContext<...>` false-positive as
missing) + `tsc --noEmit` + `vitest run`, then fast-forward `master` to
match and deploy `master` — never deploy an unmerged feature branch straight
to this VPS.

**General habit:** merge feature branches into `master` (or `master` into
them) frequently, in small steps — the longer two branches both deploy
against the same production target without merging, the more expensive this
reconciliation gets.
