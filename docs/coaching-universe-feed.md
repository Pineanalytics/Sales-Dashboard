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

One row per outlet and principal from Pine, Leverage, EABL DMS and Upfield DataEdge: the same columns as the Active Outlets extract, plus the shop id (outlets that are the same shop share one).

Filters: `status=active` (default) | `dormant` | `all`; `source=PINE|LEVERAGE|EABL|UPFIELD`; `principal=Mars-Nairobi` (exact name).

Response: `{ syncedAt, universeBuiltAt, snapshot, status, total, outlets: [...], nextCursor }`.

Each outlet row:

| Field | Meaning |
|---|---|
| `source`, `sourceCode` | System label ("Pine", "EABL DMS", "Upfield DataEdge", "Leverage") and its code (PINE, EABL, UPFIELD, LEVERAGE). |
| `outletId` | The source system's own outlet id (Pine customer id, EABL DMS customer code, Upfield outlet code, Leverage customer code). Ids from different systems can collide: key on `sourceCode` + `outletId` + `principal`. |
| `shopId`, `shopSize`, `shopConfidence` | The shop this outlet belongs to. The same shop registered twice, within or across systems, shares one `shopId` (the master outlet's record key, e.g. `PINE-12345`) on every outlet and principal row of it; `shopSize` is how many outlets it was merged from (1 = unique) and `shopConfidence` is `High` or `Medium` for a merged shop. Computed when the universe is compiled, over **every** outlet (active and dormant), by GPS point and cleaned name (identical names or the same letters within 60 m, near-identical names within 45 m; common names and wholesale / retail clashes are left apart) and by the extract's match id. Count shops on `shopId`, never on `outletId`. |
| `masterOutletId`, `duplicateGroupSize` | The same values as `shopId` and `shopSize`, under the names the feed first used (it used to be computed over the active outlets only, so a dormant outlet carried its own id). |
| `outlet`, `principal` | Outlet name and the principal this row is about (e.g. `Mars-Nairobi`). |
| `salesRole` | `Primary Sales` (direct: sold by Pinefrost reps) or `Secondary Sales` (through distributor reps). |
| `channel`, `segment`, `sourceChannel`, `sourceSegment` | Normalised channel (Retail / Wholesale) and segment, and the source system's own. |
| `location`, `region`, `territory`, `route`, `latitude`, `longitude` | Place and GPS. `route` is blank for Pine. `territory` is the name as the source system spells it. |
| `territoryClean`, `territoryGroupId`, `territoryMatch` | The unified place name several spellings share ("THIKA", "Thika - MBSR", "Nairobi-Thika" all become "Thika"; "AA Imara Daima", "Imara" and "Imara Daima" become "Imara Daima"), a stable id for that place, and how it was unified (`same name`, `name + coordinates`, `spelling + coordinates`, `address -> nearest area`; null when the name stands alone). **Group and filter by `territoryClean`.** |
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

### `resource=locations`: the unified location map

Every raw territory name with the name it was unified to, the unified places, and the relations found between places. About 1,440 raw names became about 710 places. One response, no paging.

Response: `{ syncedAt, builtAt, totals, places: [...], mapping: [...], relations: [...] }`.

- **`mapping`:** one row per raw name: `raw`, `canonical`, `groupId`, `kind` (`place`, `address` for a street or Google plus-code address, `unspecified`), `rows`, `lat`/`lon`, `sources`, `method` and `confidence` (`High` for the same name after cleaning, `Medium` where coordinates were needed).
- **`places`:** one row per unified place: `canonical`, `groupId`, every `rawNames` member, `rows`, the centre (`lat`/`lon`) and `radiusKm` (how spread the place is).
- **`relations`:** pairs the algorithm did **not** merge but that are related, with `distanceKm` and `overlap` (share of outlets in the same part of the map):
  - `possible variant`: one name continues another ("Dandora" and "Dandora Kwa Mbao") but the places are too far apart, or have no GPS, to merge safely.
  - `sub-area`: a distinguishing word ("Thika East", "Thika Road", a number) or a place sitting inside a larger one.
  - `shares coordinates`: differently named places whose outlets sit in the same part of the map ("Kware", "Kingdom Pipeline" and "Transami").

How names are unified: (1) the name, after dropping case, the "- MBSR" tag, "county", a leading city ("Nairobi-") and an "AA" sort prefix; (2) a name that continues another ("Imara" in "Imara Daima") is merged only when the two places are close on the map, allowing for how spread the larger place is; a direction, road, phase or number ("Thika East", "Githurai 44" vs "45") always keeps places apart; (3) address-style names are placed by the place named in them and by the outlets around their GPS point. Nothing is changed in the source data: the raw name is always kept.

## Example pull

```bash
BASE='https://pinefrostdb.com/api/integrations/coaching/reference'
# page 1, then follow nextCursor until it is null
curl -s -H "x-coaching-reference-key: $KEY" "$BASE?resource=universe&status=active&pageSize=1000"
curl -s -H "x-coaching-reference-key: $KEY" "$BASE?resource=universe&status=active&pageSize=1000&cursor=1000"
# the monthly history for one principal
curl -s -H "x-coaching-reference-key: $KEY" "$BASE?resource=universe-history&principal=Mars-Nairobi&pageSize=1000"
# the unified location map (one response)
curl -s -H "x-coaching-reference-key: $KEY" "$BASE?resource=locations"
```

About 67,000 universe rows is about 68 pages of 1,000 (walked in about 15 seconds on production); the pull is meant for the nightly schedule (the outlet universe itself compiles when read after 30 minutes).

## What this feed carries, by decision

On 20 October 2026 the business decided the Coaching app should receive the full universe including sales values and tiers, principal by principal, for buying
trends and rep association. Target values, credentials and dashboard-user authorization data are still never shared. Outlet contact details are not held here.
