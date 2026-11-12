# Rep directory and roster linking: scope

Status: **phase 1 deployed 2026-11-12 (PR 259); phase 2 built on `feat/rep-directory-phase2`, not yet deployed; phases 3 and 4 not built.**
Decisions in section 8 were all answered yes on 2026-11-12.

## 1. What is wanted

1. One place, a **rep directory**, where every rep identity from SAP and Pine
   can be queried by name: a sole SAP rep sync and a sole Pine rep sync.
2. For the systems with no rep table (**Leverage**, **Upfield DataEdge**, and
   EABL DMS), the same directory built from the sales/visit data already stored.
3. On the **Employee Roster**, two columns on every row, **SFA (Pine) rep name**
   and **SAP rep name**, each an immediate edit point: search the directory,
   pick, saved at once. It works whatever the automatic name matching currently
   does.

## 2. What exists today (verified 2026-11-12)

| Source | Rep table available? | How reps reach the dashboard today |
| --- | --- | --- |
| SAP | Yes, `OSLP` (salesperson master). Reachable through the existing tunnel from `sap-sync-worker`. 333 rows, 279 active, 1 locked, no blank names, 333 distinct names. Columns of use: `SlpCode`, `SlpName`, `Active`, `Locked`, `GroupCode`, `EmpID`, `U_Principle`, `U_Branch`, `U_SalesUnit`. It also holds phone and email, which this design never reads. | Only as `SlpName` joined onto each sales line inside the sales sync. The full list is read only by the old manual `db-bridge` run (`fetchRepList`), not scheduled and not stored. |
| Pine | Yes, MySQL `pine.users` (927 rows: MBSR 217, TDR 181, Admin 146, DSR 54, KAMs 27, TL 8, store roles and 202 with no group). Reachable from `live-sync-worker`. The table also holds password hashes, salts, OTP and API columns: the sync must select named columns only. | `RepCall.employeeCode` and `salesRep` from the Timestamps sync; the roster's `employeeCode` is the Pine user id. |
| Leverage (Centegy) | No rep table. | `SalesReturnLine.salesRepCode` and `salesRepName`: 13 reps in 90 days, code to name one to one. |
| Upfield DataEdge | No rep table. | `UpfieldTransaction.fsr` and `UpfieldVisit.fsr`: 15 FSRs in 90 days, a name with spaces. The FSR login comes only from the outlet list upload. |
| EABL DMS | Not asked for, but the same shape. | `EablCall.salesman`: 19 in 90 days. |

Roster state today (`EmployeeMaster`, 240 rows):

- The SAP name is free text that must be picked from "names seen in synced sales"
  (`getKnownSapSalesReps`), so a rep with no sales yet cannot be linked.
- 204 distinct SAP names for 240 employees: **36 employees share a SAP name**.
  `buildRepSales` deliberately leaves a shared name unmatched.
- For 193 of 240, the SAP name equals the Pine name. That is either genuinely the
  same or the form's default (`sapName || pineName`); the data cannot say which.
- Of the 115 SAP names with sales in the last 90 days, **30 match no roster row**.
- Pine: 150 reps active in 90 days, 1 not on the roster.
- SAP: `SalesDocument` already carries 181 distinct `slpCode` values, but nothing
  on the roster stores a code.

## 3. Design

### 3.1 Tables (additive, need `-PushSchema`)

**`RepDirectoryEntry`**: one row per identity per source.

| Column | Notes |
| --- | --- |
| `source` | `SAP`, `PINE`, `LEVERAGE`, `DATAEDGE`, `EABL_DMS` |
| `sourceKey` | SAP `SlpCode`; Pine `users.id`; Leverage `distributor|salesRepCode`; DataEdge the FSR text as sent (the login when the outlet list gives one); EABL the salesman text |
| `displayName`, `normalizedName` | spelling as the source sends it, and the existing `normalizeName` form for search |
| `origin` | `TABLE` (read from the system's own rep table) or `DERIVED` (taken from sales or visit rows) |
| `isActive`, `isFieldRep` | SAP `Active` and `Locked`; Pine `active` and sales group in DSR, MBSR, TDR, TL, KAMs, Admin; derived rows: sold or visited in 90 days |
| `groupLabel`, `region`, `principalHint`, `branch` | what the source offers: Pine `salesgroup` and `region`; SAP `U_Principle`, `U_Branch`, `U_SalesUnit`; Leverage distributor |
| `firstSeenAt`, `lastSeenAt`, `lastActivityAt` | `lastSeenAt` is the last sync that saw it; a row that disappears is marked inactive, never deleted |

Unique on (`source`, `sourceKey`). No phone, email, username or any credential
is stored.

**`EmployeeRepLink`**: which directory identity a roster employee is, per source.

| Column | Notes |
| --- | --- |
| `employeeCode` | roster key |
| `source`, `sourceKey` | the linked directory identity |
| `linkedBy`, `linkedAt` | who and when |

Unique on (`employeeCode`, `source`). Several employees may point to one identity
(the 36 shared names are people with more than one code, so it must be allowed),
and the UI warns when it happens.

**`EmployeeRepLinkChange`**: an append-only log (employee, source, from, to, by,
at), so a wrong click can be seen and undone.

`EmployeeMaster` gets two nullable columns for convenience and speed:
`sapSlpCode Int?` and `pineUserId Int?`, kept in step with the link rows. Its
text columns `sapName` and `pineName` stay.

### 3.2 Syncs (new worker jobs, same pattern as the existing ones)

| Job | Container | Source | Cadence | Notes |
| --- | --- | --- | --- | --- |
| `sap-reps` | `sap-sync-worker` | all of `OSLP`, read only | every 30 minutes | 333 rows, a sub-second query. `lastActivityAt` comes from the stored sales data, not a SAP scan (a 90-day invoice scan did not finish in minutes during scoping). |
| `pine-reps` | `live-sync-worker` | `pine.users`, **named columns only** (`id`, `first_name`, `last_name`, `company`, `salesgroup`, `region`, `category`, `active`) | every 30 minutes | 927 rows. All groups are kept and flagged, so a new store role or an unusual group is still findable. |
| `rep-directory-derive` | `live-sync-worker` | Postgres only: `SalesReturnLine`, `UpfieldTransaction`, `UpfieldVisit`, `EablCall` | every 30 minutes | no external connection. DataEdge adds the login from the Upfield outlet list when present. |

All three register in `lib/syncJobs.ts`, so they get a row on Data & sync, the
**Refresh now** button and the run record automatically.

### 3.3 Roster UI

- Two columns on every roster row, **SFA (Pine) rep** and **SAP rep**. Each shows
  the linked name and code and a state chip: *Linked*, *Name only* (the text
  matches a directory row but no link is stored), *Not linked*, or *Shared*
  (another employee holds the same identity).
- Clicking a cell opens a search box over the directory: by name, code, group,
  region. Each result shows its status, last activity, and, if taken, who holds
  it. Picking one saves at once through a server action (optimistic update, a
  message on failure) and writes the change log. A clear button removes the link.
- Saving a link also writes the directory's exact spelling to `sapName` or
  `pineName`. **Every existing consumer keeps working unchanged**, which is the
  "regardless of the existing matching logic" requirement: the link is explicit,
  and the text columns follow it.
- Filter chips above the list: *No SAP link*, *No Pine link*, *Name only*,
  *Shared*.
- Same permissions as roster editing today (`requireRosterEditor`,
  `assertCanEditEmployee`): admins any row, a team leader their own reps.
- The "must pick from names seen in sales" rule goes away; the picker reads the
  full directory, so a rep with no sales yet (the 1249 and 1250 case) can be
  linked on day one.

### 3.4 Rep Directory page (`/admin/rep-directory`, admin)

A searchable table of all five sources with filters (source, active, linked or
not, derived or from a table), the roster employee each row is linked to, and an
**unlinked queue**. Leverage, DataEdge and EABL rows show **suggested SAP
matches** ranked by name similarity (token overlap on the normalised names, plus
the SAP `U_Branch` and `U_Principle` hints). Suggestions are never applied
silently. The queue has "accept" per row and a bulk "accept all exact matches"
that lists what it will link before it runs.

## 4. Phasing (each phase deployable on its own)

1. **Directory and syncs, read only.** The three tables, the three jobs, the Rep
   Directory page and the Data & sync rows. No roster or sales behaviour changes.
2. **Roster columns and linking.** `EmployeeRepLink`, the change log, the two
   inline columns, the filter chips, and a one-time backfill that *proposes* links
   for review rather than applying them.
3. **Code-first matching in the sales sync.** `buildRepSales`, the SFA sync and
   the Coverage and Timestamps reps resolve by `SlpCode` or Pine id first and fall
   back to the name. Adds a nullable `slpCode` to `SalesRepActual` and
   `DailySalesRepActual` (their unique keys do not change) and removes the
   "shared name means unmatched" gap where the link settles it.
4. **Other systems feed the outlet universe.** `lib/outletUniverse/repIdentity.ts`
   uses the Leverage and DataEdge links instead of finding a rep by name.

Phases 1 and 2 give the requested editing experience. Phases 3 and 4 are where
the matching itself gets stronger, and can wait.

## 5. Tests

- Pine sync selects only the named columns (a test fails if a password, salt, OTP
  or API column is ever in the query text).
- Directory upserts: a rename keeps the identity, a vanished row goes inactive
  and is not deleted, a re-run is a no-op.
- Derivation from Leverage, DataEdge and EABL rows, including a code with two
  spellings.
- Linking: server action permissions (admin, team leader own rep, other
  rejected), the text columns follow the link, clear removes it, shared warning,
  change log written.
- Suggestion ranking on realistic names (middle names, order swapped, extra
  spaces, punctuation).
- Phase 3: code wins over a conflicting name; fallback when there is no code.

## 6. Deploy and operations

- Additive tables and columns: `-PushSchema`, from clean master, as always.
- Two worker jobs added to `docker-compose.yml`; every worker is rebuilt on
  deploy anyway. Register all three jobs in `docs/automation-registry.md`.
- Load is negligible: 333 + 927 rows plus a Postgres-only pass.
- Rollback: the new tables are additive and unused by old code; the text
  columns keep their meaning, so old code runs against new data.

## 7. Risks

- **Pine credentials.** `pine.users` holds hashes and OTP data. The query lists
  columns explicitly, a test guards it, and nothing sensitive is stored.
- **Shared SAP identity.** One person may hold several roster codes. The model
  allows it and warns; phase 3 decides by principal where a code is shared.
- **Derived identities are only as good as the sales text.** A DataEdge FSR who
  has no activity in 90 days is not in the directory until they sell or visit.
- **SAP renames.** A new spelling is the same `SlpCode`, so the link survives
  and the text columns refresh on the next sync, which is the improvement over
  today.

## 8. Decisions needed

1. May one SAP rep be linked to more than one roster employee (needed for the 36
   shared names), with only a warning?
2. May team leaders edit links for their own reps, as they can edit roster rows
   today, or admins only?
3. Backfill: should the first pass *propose* links for exact normalised-name
   matches (about 190 rows) for bulk acceptance, rather than apply them?
4. Phase 4 (outlet universe from links): wanted now, or after the roster is
   cleaned up?
