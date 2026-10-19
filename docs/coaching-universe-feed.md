# Active universe feed for the Coaching application

How the Coaching app (app.pinefrostdb.com) reads the active outlet universe from Pinefrost Analytics. It is the same server-to-server bridge it already uses
for the roster, outlets and performance, with two added resources. Read-only: nothing is pushed, nothing is stored on the Coaching side by this app.

## Access

| | |
|---|---|
| URL | `GET https://pinefrostdb.com/api/integrations/coaching/reference?resource=<name>&...` |
| Authentication | Header `x-coaching-reference-key: <secret>`. The secret is the environment variable `COACHING_REFERENCE_SYNC_KEY`, the same name and value on both applications (rotate both together). Missing or wrong key: HTTP 401. Never put it in a URL. |
| Caching | Responses are `Cache-Control: no-store`. The server keeps the built universe for 10 minutes, so paging through it is cheap; the first call after that takes a few seconds (10-20 s). |
| Paging | `pageSize` (default 500, maximum 1,000, the same limit as the other resources) and `cursor`. Start without a cursor; keep sending the `nextCursor` of the previous response until it is `null`. |
| Consistency | Each response carries `universeBuiltAt` (when the outlet universe was last compiled) and `snapshot` (when this server built the feed). If either changes between two pages of one pull, start the pull again from the first page. |

## Resources

### `resource=universe`: every outlet x principal, all four systems

One row per outlet and principal from Pine, Leverage, EABL DMS and Upfield DataEdge: the same columns as the Active Outlets extract, plus the master outlet id.

Filters: `status=active` (default) | `dormant` | `all`; `source=PINE|LEVERAGE|EABL|UPFIELD`; `principal=Mars-Nairobi` (exact name).

Response: `{ syncedAt, universeBuiltAt, snapshot, status, total, outlets: [...], nextCursor }`.

Each outlet row:

| Field | Meaning |
|---|---|
| `source`, `sourceCode` | System label ("Pine", "EABL DMS", "Upfield DataEdge", "Leverage") and its code (PINE, EABL, UPFIELD, LEVERAGE). |
| `outletId` | The source system's own outlet id (Pine customer id, EABL DMS customer code, Upfield outlet code, Leverage customer code). Ids from different systems can collide: key on `sourceCode` + `outletId` + `principal`. |
| `masterOutletId`, `duplicateGroupSize` | The same shop registered twice (within or across systems) shares one master id. Computed over the active outlets (matched by GPS point within 60 m and cleaned name, and by the extract's match id); a dormant outlet carries its own id. Count shops on `masterOutletId`, never on `outletId`. |
| `outlet`, `principal` | Outlet name and the principal this row is about (e.g. `Mars-Nairobi`). |
| `salesRole` | `Primary Sales` (direct: sold by Pinefrost reps) or `Secondary Sales` (through distributor reps). |
| `channel`, `segment`, `sourceChannel`, `sourceSegment` | Normalised channel (Retail / Wholesale) and segment, and the source system's own. |
| `location`, `region`, `territory`, `route`, `latitude`, `longitude` | Place and GPS. `route` is blank for Pine. |
| `rep`, `repSfaId`, `teamLeader`, `repStatus`, `repRegion`, `repSubRegion` | **The rep who sells this principal at the outlet**, their SFA code, their Team Leader, whether they are an Active or Inactive worker, and where they are placed. Blank where the rep is not on the roster. |
| `plannedRep` | Pine's journey-plan owner of the outlet (the same on every principal). |
| `repsServing`, `repsByPrincipal`, `teamLeadersByPrincipal` | How many distinct reps serve the outlet across its principals, and who sells which ("Mars-Nairobi: Ann; Suntory-Nairobi: Bob"). |
| `status`, `lastPurchase`, `daysSincePurchase`, `dormancyFlag` | `Active` = bought in the last 90 days. |
| `salesYtd`, `transactionsYtd`, `averageSale`, `combinedAverageSale`, `tier` | Year-to-date sales (KES), invoices, average invoice, and the extract's tier. For a cleaner tier use `averageSale` per master outlet. |
| `buyingSince`, `monthsBuying`, `buyingTenure` | Tenure from the first purchase on record. |
| `periodsBoughtLast3`, `consistency`, `periodsBoughtLast6`, `consistency6Months`, `boughtLast30Days`, `boughtLast3Months`, `boughtLast6Months` | Buying regularity over 30-day periods and windows. |
| `dominantPrincipal`, `dominantSharePct`, `principalMix`, `principalsBought`, `sharedPrincipals` | The outlet's principal portfolio. |
| `matchId`, `matchConfidence`, `matchedSystems` | The same shop in another system. |

### `resource=universe-history`: monthly buying and calls per outlet x principal

The buying trend. One row per source, principal and outlet, with only the months that had activity this calendar year.

Filters: `source=...`, `principal=...`. Response: `{ syncedAt, universeBuiltAt, snapshot, total, history: [...], nextCursor }`.

```json
{ "source": "Pine", "sourceCode": "PINE", "outletId": "27424", "principal": "Mars-Nairobi",
  "months": { "2026-08": { "sales": 1540.2, "transactions": 3, "calls": 1, "productive": 1 },
              "2026-09": { "sales": 0, "transactions": 0, "calls": 1, "productive": 0 } } }
```

- `sales` / `transactions`: what the outlet bought that month (KES, net of returns; invoices).
- `calls` / `productive`: customer-months called and productive, by the rules of the Coverage page (Pine: reps that visited and those with a sale or order; EABL DMS and Upfield DataEdge: the customer-month, productive if any call or sale). Strike rate = `productive` / `calls`.
- **Leverage** records completed documents only, so `calls` counts the customer-months with a document and `productive` is `null`: there is no strike rate for it.
- A month with calls but no purchase shows `calls: 1, productive: 0`: the outlet was visited and did not buy.

## Example pull

```bash
BASE='https://pinefrostdb.com/api/integrations/coaching/reference'
# page 1, then follow nextCursor until it is null
curl -s -H "x-coaching-reference-key: $KEY" "$BASE?resource=universe&status=active&pageSize=1000"
curl -s -H "x-coaching-reference-key: $KEY" "$BASE?resource=universe&status=active&pageSize=1000&cursor=1000"
# the monthly history for one principal
curl -s -H "x-coaching-reference-key: $KEY" "$BASE?resource=universe-history&principal=Mars-Nairobi&pageSize=1000"
```

About 67,000 universe rows is about 68 pages of 1,000 (walked in about 15 seconds on production); the pull is meant for the nightly schedule (the outlet universe itself compiles when read after 30 minutes).

## What this feed carries, by decision

On 20 October 2026 the business decided the Coaching app should receive the full universe including sales values and tiers, principal by principal, for buying
trends and rep association. Target values, credentials and dashboard-user authorization data are still never shared. Outlet contact details are not held here.
