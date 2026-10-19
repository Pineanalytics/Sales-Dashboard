// The "what the data says" findings of the executive view, written from the numbers each time so they never go stale.
import { concentration, coverageBy, summarise, universe } from "./metrics";
import type { FactRow } from "./types";

export interface Insight {
  title: string;
  text: string;
}

const pct = (value: number | null, digits = 1) => (value === null ? "n/a" : `${(value * 100).toFixed(digits)}%`);
const num = (value: number) => Math.round(value).toLocaleString("en-KE");
const million = (value: number) => `KES ${(value / 1e6).toFixed(1)}M`;

export function buildInsights(rows: FactRow[], monthLabel: string, sourcesWithoutCalls: string[]): Insight[] {
  const out: Insight[] = [];
  if (rows.length === 0) return out;
  const total = summarise(rows)[0];
  const direct = summarise(rows.filter((r) => r.isDirect))[0];
  const distributor = summarise(rows.filter((r) => !r.isDirect))[0];

  // 1. Headline strike in the month.
  if (total.strikeRate !== null) {
    out.push({
      title: `${pct(total.strikeRate)} of covered outlets bought in ${monthLabel}`,
      text: `${num(total.productiveCalls)} of ${num(total.callsWithOutcome)} calls with a recorded outcome produced an order (direct ${pct(direct.strikeRate)}, distributor ${pct(distributor.strikeRate)}). ${num(total.unproductiveCalls)} calls had no order, worth about ${million(total.unproductiveValue)} at each outlet's usual invoice.`,
    });
  }

  // 2. The weakest route and channel with a meaningful number of calls.
  const routeChannel = summarise(rows, ["route_class", "channel"]).filter((g) => g.callsWithOutcome >= 200 && g.strikeRate !== null);
  if (routeChannel.length >= 2) {
    const weakest = routeChannel.reduce((a, b) => ((a.strikeRate as number) <= (b.strikeRate as number) ? a : b));
    const strongest = routeChannel.reduce((a, b) => ((a.strikeRate as number) >= (b.strikeRate as number) ? a : b));
    out.push({
      title: `${weakest.key.route_class} ${String(weakest.key.channel).toLowerCase()} converts least`,
      text: `${weakest.key.route_class} ${String(weakest.key.channel).toLowerCase()} calls convert ${pct(weakest.strikeRate)} against ${pct(strongest.strikeRate)} for ${String(strongest.key.route_class).toLowerCase()} ${String(strongest.key.channel).toLowerCase()}; its ${num(weakest.unproductiveCalls)} unproductive calls carry ${million(weakest.unproductiveValue)}.`,
    });
  }

  // 3. Recency: does a quiet outlet also convert worse?
  const recency = summarise(rows, ["recency"]).filter((g) => g.callsWithOutcome >= 100 && g.strikeRate !== null);
  const recent = recency.find((g) => g.key.recency === "0-7 days");
  const oldest = [...recency].reverse().find((g) => g.key.recency !== "0-7 days");
  if (recent && oldest && (recent.strikeRate as number) > (oldest.strikeRate as number)) {
    out.push({
      title: "Falling strike predicts lapsing",
      text: `Strike is ${pct(recent.strikeRate)} for outlets that bought in the last week and ${pct(oldest.strikeRate)} for those whose last purchase was ${String(oldest.key.recency).replace(" days", "")} days ago: treat a falling strike as an early warning.`,
    });
  }

  // 4. Reach.
  const u = universe(rows);
  const byRegion = coverageBy(rows, "region").filter((g) => g.universe >= 200);
  if (u.directReach !== null) {
    const lowest = byRegion.length ? byRegion.reduce((a, b) => (a.directReach <= b.directReach ? a : b)) : null;
    out.push({
      title: "Most of the universe is not served directly",
      text: `Pinefrost reps reach ${num(u.directOutlets)} of ${num(u.uniqueOutlets)} unique active outlets (${pct(u.directReach, 0)}); ${num(u.distributorOnly)} buy only through distributor reps.${lowest ? ` Direct reach is lowest in ${lowest.value} (${pct(lowest.directReach, 0)} of ${num(lowest.universe)} outlets).` : ""}`,
    });
  }

  // 5. Concentration.
  const conc = concentration(rows).find((c) => c.topShareOfOutlets === 0.01);
  if (conc) out.push({ title: "Value is highly concentrated", text: `The top 1% of outlets (${num(conc.outlets)}) generate ${pct(conc.shareOfSales, 0)} of year-to-date sales; protect and grow these before widening the base.` });

  // 6. Single-principal outlets.
  const directByOutlet = new Map<string, Set<string>>();
  for (const r of rows) if (r.isDirect) (directByOutlet.get(r.masterId) ?? directByOutlet.set(r.masterId, new Set()).get(r.masterId)!).add(r.principal);
  if (directByOutlet.size) {
    const single = [...directByOutlet.values()].filter((s) => s.size === 1).length;
    out.push({ title: "Outlets buy from one principal", text: `${pct(single / directByOutlet.size, 0)} of direct outlets buy a single principal: the cross-sell list shows the best next principal for each.` });
  }

  // 7. Data caveats that change how strike should be read.
  const notes: string[] = [];
  if (sourcesWithoutCalls.length) notes.push(`${sourcesWithoutCalls.join(" and ")} have no call data for ${monthLabel}`);
  notes.push("Leverage records completed documents only, so it has no strike rate");
  const upfield = summarise(rows.filter((r) => r.source === "Upfield DataEdge"))[0];
  if (upfield.strikeRate !== null && upfield.strikeRate > 0.97 && upfield.callsWithOutcome > 100) notes.push(`Upfield shows ${pct(upfield.strikeRate)}: DataEdge probably logs a visit only when an order is taken`);
  out.push({ title: "Read strike with these limits", text: `${notes.join("; ")}. Strike is shown for one month at a time: a year-to-date figure blends months and hides where the field stands today.` });
  return out;
}
