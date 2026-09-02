# Release checklist

Use this checklist for every code, scheduler, VPS environment, or production
configuration change. Its purpose is to prevent separate sessions from
overwriting one another or deploying unreviewed work together.

## 1. Start work safely

- [ ] Read `AGENTS.md`, this checklist, `docs/production-governance.md`, and
      `docs/automation-registry.md`.
- [ ] Create a dedicated feature branch and worktree. Do not have two chat
      sessions edit the same checkout.
- [ ] Inspect `git status` before editing and preserve unrelated changes.
- [ ] Identify the affected registry entry, data source, schedule, destination,
      alerting path, and rollback method.

## 2. Make one coherent change

- [ ] Keep application code, protected environment changes, and download-machine
      artifact installation distinct in the pull-request description.
- [ ] Never commit passwords, API keys, tokens, `.env` files, downloaded data,
      or browser/session profiles.
- [ ] For a schedule change, state all times with their time zone and confirm
      overlap/missed-run behavior.
- [ ] For an automation that writes files, preserve atomic delivery, validation,
      non-overwrite rules, and single-instance protection.

## 3. Validate before review

- [ ] Run focused tests plus `npm.cmd test`, TypeScript validation, and the
      production build when app code changes.
- [ ] Run PowerShell parser validation for every changed `.ps1` file.
- [ ] Run `git diff --check`.
- [ ] For a live integration, use only a small, authorised, non-destructive
      test and record its result without exposing secrets or report contents.

## 4. Merge and release deliberately

- [ ] Open one pull request with a clear scope and validation summary.
- [ ] Merge only after the required **Validate master** check passes.
- [ ] Before deploying, use the clean deployment checkout only:

      ```powershell
      Set-Location 'D:\sales-dashboard-deploy-clean-20260831'
      git pull --ff-only origin master
      git status
      git log -1 --oneline
      ```

- [ ] If master contains unrelated commits, stop and make a release decision;
      do not silently deploy a broader batch merely to release one feature.
- [ ] Deploy application code only with `scripts/deploy.ps1`; use `-PushSchema`
      only for an approved additive Prisma change.
- [ ] For a download-machine-only change, install from the exact merged commit
      and validate its syntax/markers before replacing the installed artifact.

## 5. Verify and hand over

- [ ] Confirm `/api/health` returns HTTP 200 and the expected commit after a VPS
      deployment.
- [ ] Confirm affected scheduled tasks have the intended action, schedule,
      `NextRunTime`, and `LastTaskResult`.
- [ ] Confirm one controlled delivery or reconciliation result where safe.
- [ ] Update `docs/automation-registry.md` if any operational fact changed.
- [ ] Record the merged commit, deployed commit, validation results, any manual
      action still required, and rollback location.

## Incident rule

If a process becomes stale, do not first change schedules or overwrite files.
Check task history, state/revision data, root and Archive locations, API health,
and the downstream consumer. Change only the identified failing boundary.
