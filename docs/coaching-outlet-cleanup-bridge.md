# Outlet Cleanup for the Coaching application

The Coaching app (Coap, the Android app and web app at app.pinefrostdb.com) carries the Outlet Cleanup to the field: team leaders, supervisors and sales reps check and correct their outlets on a phone, at the outlet. The cleanup stays **one module with one set of rules and one set of tables**, owned by this application. The Coaching app is a second client of it, not a second implementation.

## How it is connected

`POST /api/integrations/coaching/cleanup` (server to server, header `x-coaching-reference-key`, the same shared key as the other coaching bridge resources). The Coaching app's server has already signed the person in with its own login and says who they are:

```json
{
  "identity": { "role": "TEAM_LEADER", "name": "Eve Theuri", "email": "eve.theuri@pinefrost.co.ke" },
  "path": "outlet",
  "method": "GET",
  "query": { "source": "PINE", "key": "12345" }
}
```

| `role` | Identified by | Resolved against |
|---|---|---|
| `TEAM_LEADER` | `name` | `TeamLeader.name` (ignoring case and spacing) |
| `SUPERVISOR` | `name` | `Supervisor.name`; their scope is the team leaders under them (not "Former"), and their own name |
| `REP` | `repCode` | `EmployeeMaster.employeeCode`, active; their scope is the outlet rows they sell (`OutletUniverse.repCode`) |
| `HOD`, `DIRECTOR` | `name` | view everything, change nothing |

The route resolves that person into the same `CleanupActor` a signed-in user of this application gets (`resolveBridgeActor` in `lib/outletCleanup/access.ts`) and runs **the same route handlers the Outlet Cleanup page calls** (`app/api/outlet-cleanup/{queue,filters,outlet,routes,open,progress,review,disown}`), as that person, through an `AsyncLocalStorage` that only this route can set (`runAsBridgeActor`). `path` names one of those handlers, `method` is `GET` or `POST`, `query` and `body` are exactly what the page sends. The answer is the handler's own status and JSON. A person who is not on the roster tables gets 403 ("ask an admin to link your name"); the Coaching app links team leaders and supervisors to roster names with its own aliases (the same ones as the Realignment page).

A sales rep may only call `queue`, `filters` and `outlet` (GET), and `outlet` POST with the actions `save`, `geo`, `reps` (confirm only, never change the selling rep), `draft`, `discardDraft` and `final`. Everything else is refused with 403.

## What is new in the module (additive)

- **`OutletCleanupEntry.status = SUBMITTED`**: a sales rep's saved work. It locks nothing, counts for nothing (progress counts exclude it) and is never laid over the universe. A rep can keep editing it until it is approved.
- **Approval**: the rep's team leader, a supervisor over them, or an admin approves it (`approveSubmissions`; `POST /api/outlet-cleanup/review` with `kind: "submissions"`, `decision: "APPROVE" | "SEND_BACK"`, a reason is needed to send back). Approving locks the fields the rep settled, makes the entry `REVIEWED` (counts as progress) and sends it on to validation. Sending back clears the rep's decisions and unlocks the entry (`REJECTED`).
- **Validation by supervisors**: `REVIEWED` entries are validated or sent back by an admin **or by a supervisor for the team leaders under them** (never their own work). Duplicate calls stay admin-only.
- **Review lists**: `GET /api/outlet-cleanup/review` is open to admins (everything), supervisors (their teams) and team leaders (the `SUBMITTED` list of their reps). The Review tab on the Cleanup page shows to the same people.
- **New columns on `OutletCleanupEntry`** (all nullable, additive, `-PushSchema`): `submittedRole` (`REP`, `TEAM_LEADER`, `SUPERVISOR`), `approvedBy`, `approvedAt`.
- **Queue filter** `state=submitted`; the `OutletDetail` answer carries `canApprove`, `canValidate` and `submittedRole`.
- Labels: `REVIEWED` now reads "Awaiting validation", `SUBMITTED` "Awaiting approval".

Nothing else changes: validated work reaches `OutletUniverse` through the same overlay at compile, approved values still win over the source systems, and every change is in `OutletCleanupLog` with the person's email and role.

## What the Coaching app adds around it

- It authenticates the person (its own login), maps them to a roster name (team leaders and supervisors by their linked Dashboard name, reps by the user code on their linked rep record) and calls this route. Reps register in the Coaching app with their user code and are accepted by their team leader, which is also what ties them to this code.
- Phone screens for every tab of the page: outlets and the outlet form (including the GPS tag at the outlet), routes, marked open outlets, review and approval, progress and the report.
