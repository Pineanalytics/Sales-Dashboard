// Commentary for the Performance Analysis page, written from the data on every
// refresh. The standalone report's commentary was hand-written for one period;
// here each sentence is derived from the payload, so it is always about the
// numbers on the screen. `**text**` marks the figures the renderer bolds.
import type { GpBasis, ItemRow, PerformancePayload, PrincipalRow } from "./types";

const MONTH_ABBREV = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function compact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(0)}K`;
  return String(Math.round(value));
}

export const kes = (value: number): string => `KES ${compact(value)}`;
const pct = (value: number | null, places = 1): string => (value === null ? "n/a" : `${value.toFixed(places)}%`);
const signedPct = (value: number | null): string => (value === null ? "n/a" : `${value >= 0 ? "+" : "-"}${Math.abs(value).toFixed(1)}%`);
const signedKes = (value: number): string => `${value >= 0 ? "+" : "-"}${kes(Math.abs(value))}`;
const monthName = (month: string): string => MONTH_ABBREV[Number(month.slice(5, 7)) - 1] ?? month;

const MONTH_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** The selected period in words: "September 2026", or "1 Jan \u2013 6 Oct 2026" (a month in progress ends on the date of the SAP read). */
export function periodText(p: PerformancePayload): string {
  if (p.scope.length === 0) return "the selected period";
  const first = p.scope[0];
  const last = p.scope[p.scope.length - 1];
  if (p.scope.length === 1 && !p.mtd) return `${MONTH_FULL[Number(last.slice(5, 7)) - 1]} ${last.slice(0, 4)}`;
  const endDay = p.mtd ? Number(p.asOf.split("-")[2]) : new Date(Date.UTC(Number(last.slice(0, 4)), Number(last.slice(5, 7)), 0)).getUTCDate();
  const startYear = first.slice(0, 4) === last.slice(0, 4) ? "" : ` ${first.slice(0, 4)}`;
  return `1 ${monthName(first)}${startYear} \u2013 ${endDay} ${monthName(last)} ${last.slice(0, 4)}`;
}

/** Months of the selected period, and those of them that are complete (the last is left out while it is in progress). */
const scopeRows = (p: PerformancePayload) => p.monthly.filter((row) => row.inScope);
const fullScopeRows = (p: PerformancePayload) => (p.mtd ? scopeRows(p).slice(0, -1) : scopeRows(p));

const qLabel = (p: PerformancePayload): string => (p.labels.cq && p.labels.pq ? `${p.labels.cq} vs ${p.labels.pq}` : "latest quarter");

function listNames(rows: { name: string }[]): string {
  if (rows.length <= 1) return rows[0]?.name ?? "";
  return `${rows
    .slice(0, -1)
    .map((row) => row.name)
    .join(", ")} and ${rows[rows.length - 1].name}`;
}

const materialPrincipals = (p: PerformancePayload): PrincipalRow[] => p.principals.filter((row) => p.kpi.sales > 0 && row.sales / p.kpi.sales > 0.01);

function itemLabel(item: ItemRow): string {
  return item.name.length > 42 ? `${item.name.slice(0, 41)}…` : item.name;
}

/** The numbered "What the numbers say" panel. */
export function buildFindings(p: PerformancePayload): string[] {
  const k = p.kpi;
  const out: string[] = [];
  if (p.months.length === 0) return out;

  // 1. Headline, and what moved the quarter
  const bridgeByGp = [...p.bridge].sort((a, b) => b.dg - a.dg);
  let headline = `Net sales of **${kes(k.sales)}** and GP of **${kes(k.gp)}** (${pct(k.gpm, 2)} margin) for ${periodText(p)}.`;
  if (k.avgMonth !== null && p.scope.length > 1) headline +=` The average full month is ${kes(k.avgMonth)}.`;
  if (k.cqSales !== null && k.pqSales !== null && p.labels.cq && p.labels.pq) {
    headline += ` ${p.labels.cq} (${kes(k.cqSales)}) was ${signedPct(k.cqSalesGrowth)} on ${p.labels.pq}, with GP ${signedPct(k.cqGpGrowth)}`;
    const gain = bridgeByGp[0];
    const loss = bridgeByGp[bridgeByGp.length - 1];
    if (gain && loss && gain.dg > 0 && loss.dg < 0) headline += `: ${gain.p} added ${kes(gain.dg)} of GP while ${loss.p} gave back ${kes(-loss.dg)}`;
    headline += ".";
  }
  out.push(headline);

  // 2. Concentration across principals
  const [first, second] = p.principals;
  if (first && k.sales > 0) {
    const topTwo = second ? first.share + second.share : first.share;
    let line = second
      ? `**${first.p} (${pct(first.share)}) and ${second.p} (${pct(second.share)})** are ${pct(topTwo, 0)} of sales.`
      : `**${first.p}** is ${pct(first.share)} of sales.`;
    const grower = materialPrincipals(p)
      .filter((row) => row.cqGrowth !== null && row.cqSales - row.pqSales > 0)
      .sort((a, b) => b.cqSales - b.pqSales - (a.cqSales - a.pqSales))[0];
    if (grower && p.labels.cq && p.labels.pq) {
      line += ` ${grower.p} added ${kes(grower.cqSales - grower.pqSales)} in ${p.labels.cq} (${signedPct(grower.cqGrowth)}) at a ${pct(grower.cqGpm, 1)} margin${first.gpm !== null && grower.p !== first.p ? `, against ${pct(first.gpm)} for ${first.p}` : ""}.`;
    }
    out.push(line);
  }

  // 3. The principal that cost the most gross profit, plus any below-cost items
  const worst = bridgeByGp[bridgeByGp.length - 1];
  const worstRow = worst ? p.principals.find((row) => row.p === worst.p) : undefined;
  if (worstRow && worst.dg < 0 && p.labels.cq && p.labels.pq) {
    let line = `**${worstRow.p} is the biggest GP risk**: sales ${signedPct(worstRow.cqGrowth)} in ${p.labels.cq}, GP ${signedPct(worstRow.cqGpGrowth)}, margin ${pct(worstRow.pqGpm)} to ${pct(worstRow.cqGpm)}.`;
    const own = p.belowCost.filter((item) => item.p === worstRow.p);
    if (own.length > 0) line += ` ${own.length} of its items ${own.length === 1 ? "sells" : "sell"} below cost, led by ${itemLabel(own[0])} (${pct(own[0].gpm)} on ${kes(own[0].sales)}).`;
    out.push(line);
  } else if (p.belowCost.length > 0) {
    const worstItem = p.belowCost[0];
    out.push(`**${p.belowCost.length} items sell below cost**, led by ${itemLabel(worstItem)} (${pct(worstItem.gpm)} on ${kes(worstItem.sales)}).`);
  }

  // 4. Biggest decliners and growers among principals
  if (p.labels.cq && p.labels.pq) {
    const movers = materialPrincipals(p).filter((row) => row.cqGrowth !== null);
    const falling = movers.filter((row) => (row.cqGrowth as number) <= -5).sort((a, b) => a.cqSales - a.pqSales - (b.cqSales - b.pqSales)).slice(0, 3);
    const rising = movers.filter((row) => (row.cqGrowth as number) >= 5).sort((a, b) => (b.cqGrowth as number) - (a.cqGrowth as number)).slice(0, 2);
    const parts: string[] = [];
    if (falling.length > 0) parts.push(`${falling.map((row) => `${row.p} (${signedPct(row.cqGrowth)})`).join(", ")} lost ${kes(falling.reduce((s, row) => s + (row.pqSales - row.cqSales), 0))} of ${p.labels.cq} sales${falling.length > 1 ? " between them" : ""}`);
    if (rising.length > 0) parts.push(`${rising.map((row) => `${row.p} (${signedPct(row.cqGrowth)})`).join(" and ")} ${rising.length === 1 ? "is" : "are"} the smaller growers`);
    if (parts.length > 0) out.push(`${parts.join("; ")}.`);
  }

  // 5. Item concentration
  if (p.skuActive > 0) {
    out.push(`The top 10 items make up **${pct(p.top10Share)}** of sales, and just ${p.sku80} of ${p.skuActive} SKUs deliver 80% of revenue, so availability on that short list matters more than range breadth.`);
  }

  // 6. Customer concentration
  const c = p.concentration;
  if (c.tActive > 0) {
    const a = p.abc.find((row) => row.cls === "A");
    const tail = p.abc.find((row) => row.cls === "C");
    let line = `Among trade customers, **${c.t80} of ${c.tActive.toLocaleString()} (${pct((c.t80 / c.tActive) * 100, 0)})** make up 80% of sales; the top 20 contribute ${pct(c.tTop20)}.`;
    if (a && tail && a.gpm !== null && tail.gpm !== null) line += ` A-class customers buy at a ${pct(a.gpm)} margin versus ${pct(tail.gpm)} for the long tail.`;
    out.push(line);
  }

  // 7. Returns
  if (k.cnPct !== null) {
    const worstReturns = materialPrincipals(p)
      .filter((row) => row.cnPct !== null)
      .sort((a, b) => (b.cnPct as number) - (a.cnPct as number))
      .slice(0, 3);
    let line = `Credit notes reverse **${pct(k.cnPct)}** of gross invoicing (${kes(-k.cn)}).`;
    if (worstReturns.length > 0) line += ` ${worstReturns.map((row) => `${row.p} (${pct(row.cnPct, 0)})`).join(", ")} have the highest return rates, which is worth a root-cause review (expiries, van reconciliation or invoicing errors).`;
    out.push(line);
  }

  // 8. New-customer acquisition
  // Only the months of the selected period count, and at least three are needed for a trend.
  const inScopeMonths = new Set(p.scope);
  const fullMovement = p.movement.slice(1, p.mtd ? -1 : undefined).filter((row) => inScopeMonths.has(row.m));
  if (fullMovement.length >= 3) {
    const peak = fullMovement.reduce((best, row) => (row.new > best.new ? row : best), fullMovement[0]);
    const latest = fullMovement[fullMovement.length - 1];
    if (peak.new >= 20 && latest.new < peak.new * 0.6) {
      out.push(`New trade customer acquisition has slowed from ${peak.new} in ${monthName(peak.m)} to ${latest.new} in ${monthName(latest.m)}; growth is now coming from existing accounts.`);
    } else if (latest.new > 0) {
      out.push(`${latest.new} new trade customers bought in ${monthName(latest.m)} (peak ${peak.new} in ${monthName(peak.m)}), with ${latest.reactivated} reactivated and ${latest.lost} lapsed against the month before.`);
    }
  }
  return out;
}

export function principalLede(p: PerformancePayload): string {
  const [first, second] = p.principals;
  if (!first) return "No sales were recorded in this period.";
  if (!second) {
    // One principal (a principal filter is on): describe it rather than rank it.
    const change = first.cqGrowth !== null && p.labels.cq && p.labels.pq ? `, ${signedPct(first.cqGrowth)} ${qLabel(p)}` : "";
    return `${first.p} sold ${kes(first.sales)} in this period at a ${pct(first.gpm, 1)} gross margin${change}.`;
  }
  let text = `${first.p} and ${second.p} carry the business: together ${pct(first.share + second.share, 0)} of net sales.`;
  const grower = materialPrincipals(p)
    .filter((row) => row.cqGrowth !== null && row.cqGrowth > 0)
    .sort((a, b) => (b.cqGrowth as number) - (a.cqGrowth as number))[0];
  const fallers = materialPrincipals(p).filter((row) => row.cqGrowth !== null && row.cqGrowth <= -5);
  if (grower && p.labels.cq && p.labels.pq) text += ` ${grower.p} grew fastest (${signedPct(grower.cqGrowth)} ${qLabel(p)})`;
  if (fallers.length > 0 && p.labels.cq && p.labels.pq) text += `${grower ? ", while" : ""} ${listNames(fallers.slice(0, 3).map((row) => ({ name: row.p })))} shrank (${fallers.slice(0, 3).map((row) => signedPct(row.cqGrowth)).join(", ")})`;
  return `${text.replace(/\s+$/, "")}${text.endsWith(".") ? "" : "."}`;
}

/** Principals that stopped selling or only started, so their quarter growth is blank by design. */
export function principalNote(p: PerformancePayload): string | null {
  if (!p.labels.cq || !p.labels.pq) return null;
  const stopped = p.principals.filter((row) => row.pqSales >= 1e6 && row.cqSales < row.pqSales * 0.1);
  const started = p.principals.filter((row) => row.pqSales < 1e5 && row.cqSales >= 1e5);
  const parts: string[] = [];
  if (stopped.length > 0) parts.push(`${listNames(stopped.map((row) => ({ name: row.p })))} effectively stopped trading in ${p.labels.cq} (down ${stopped.map((row) => pct(Math.abs(growthOf(row.cqSales, row.pqSales)), 0)).join(", ")}).`);
  if (started.length > 0) parts.push(`${listNames(started.map((row) => ({ name: row.p })))} ${started.length === 1 ? "is a new line" : "are new lines"} that started in ${p.labels.cq}, so there is no ${p.labels.pq} base to grow from.`);
  return parts.length > 0 ? parts.join(" ") : null;
}

const growthOf = (current: number, base: number): number => (base > 0 ? (current / base - 1) * 100 : 0);

export function monthlyLede(p: PerformancePayload): string {
  const full = fullScopeRows(p);
  if (full.length === 0) return `Net sales so far are ${kes(p.kpi.sales)}; no month of this period has closed yet.`;
  if (full.length === 1) return `Net sales were ${kes(full[0].sales)} in ${monthName(full[0].m)}${p.mtd ? `, with ${kes(p.kpi.mtdSales)} so far in the month in progress` : ""}. The trend below shows the months before it for context.`;
  const best = full.reduce((a, b) => (b.sales > a.sales ? b : a));
  const lowest = full.reduce((a, b) => (b.sales < a.sales ? b : a));
  return `Monthly net sales have ranged between ${kes(lowest.sales)} (${monthName(lowest.m)}) and ${kes(best.sales)} (${monthName(best.m)}) across ${full.length} full month${full.length === 1 ? "" : "s"}.`;
}

export function monthlyNote(p: PerformancePayload): string | null {
  if (!p.mtd || p.months.length === 0) return null;
  const last = p.monthly[p.monthly.length - 1];
  const day = Number(p.asOf.split("-")[2]);
  const name = monthName(last.m);
  return `${name} covers 1–${day} ${name} only, so it is left out of month-on-month growth. Its sales so far are ${kes(last.sales)}.`;
}

export type ItemView = "top10" | "top10gp" | "gainers" | "decliners" | "belowCost";

export function itemCaption(p: PerformancePayload, view: ItemView): string {
  const rows = p[view];
  if (rows.length === 0) {
    if (view === "gainers" || view === "decliners") return "A comparison needs a complete earlier period to compare against.";
    return view === "belowCost" ? "No item is selling below cost in this period." : "Nothing to show yet.";
  }
  const lead = rows[0];
  switch (view) {
    case "top10":
      return `The top 10 items generate ${pct(p.top10Share)} of net sales, led by ${itemLabel(lead)} (${pct(lead.share, 2)}).`;
    case "top10gp": {
      const share = p.kpi.gp > 0 ? (rows.reduce((s, row) => s + row.gp, 0) / p.kpi.gp) * 100 : null;
      return `The top 10 items by gross profit contribute ${pct(share)} of GP, led by ${itemLabel(lead)} (${kes(lead.gp)}).`;
    }
    case "gainers":
      return `${p.labels.cq} growth was led by ${itemLabel(lead)} (${signedKes(lead.delta)}${lead.cqGrowth !== null ? `, ${signedPct(lead.cqGrowth)}` : ""}) and ${rows[1] ? itemLabel(rows[1]) : "the next items"}.`;
    case "decliners":
      return `The largest ${p.labels.cq} declines were ${itemLabel(lead)} (${signedKes(lead.delta)}${lead.cqGrowth !== null ? `, ${signedPct(lead.cqGrowth)}` : ""}) and ${rows[1] ? itemLabel(rows[1]) : "the next items"}.`;
    case "belowCost":
      return `These items sold below cost in this period; ${itemLabel(lead)} alone lost ${kes(-lead.gp)} of gross profit on ${kes(lead.sales)} of sales.`;
  }
}

export function customerLede(p: PerformancePayload): string {
  const c = p.concentration;
  const lead = p.topTrade[0];
  let text = `${c.active.toLocaleString()} accounts bought in this period. Excluding route vans, counters and cash accounts leaves ${c.tActive.toLocaleString()} trade customers`;
  text += lead ? `, led by ${lead.name} at ${pct(lead.share, 1)} of trade sales.` : ".";
  return text;
}

export function customerNote(p: PerformancePayload): string | null {
  const c = p.concentration;
  if (c.internalCount === 0) return null;
  const first = scopeRows(p)[0];
  const lastFull = fullScopeRows(p).slice(-1)[0];
  const trend = first && lastFull && first.sales !== 0 && lastFull.sales !== 0 && first.m !== lastFull.m ? ` Their share of sales went from ${pct(100 - (first.trade / first.sales) * 100, 0)} in ${monthName(first.m)} to ${pct(100 - (lastFull.trade / lastFull.sales) * 100, 0)} in ${monthName(lastFull.m)}.` : "";
  return `About ${pct(c.internalShare, 0)} of sales (${c.internalCount} accounts) is booked to route vans, counters and cash-customer accounts. These are internal selling points, not end customers, so the trade view excludes them.${trend}`;
}

export function growthLede(p: PerformancePayload): string {
  const full = fullScopeRows(p).filter((row) => row.gpm !== null);
  if (full.length === 0) return `Gross profit so far is ${kes(p.kpi.gp)} (${pct(p.kpi.gpm, 2)} margin); no month of this period has closed yet.`;
  const margins = full.map((row) => row.gpm as number);
  const lowM = Math.min(...margins);
  const highM = Math.max(...margins);
  const byGp = [...p.principals].sort((a, b) => b.gp - a.gp);
  const lead = byGp[0];
  const weak = materialPrincipals(p)
    .filter((row) => row.gpm !== null)
    .sort((a, b) => (a.gpm as number) - (b.gpm as number))[0];
  let text = full.length === 1 ? `Gross profit is ${kes(p.kpi.gp)} at a ${pct(p.kpi.gpm, 2)} margin.` : `Monthly gross margin has stayed between ${pct(lowM, 1)} and ${pct(highM, 1)}, with GP of ${kes(p.kpi.gp)} over the period.`;
  if (lead) text += ` ${lead.p} earns the most GP (${kes(lead.gp)} at ${pct(lead.gpm)})`;
  if (weak && weak.p !== lead?.p) text += `; ${weak.p} has the thinnest margin at ${pct(weak.gpm)}`;
  return `${text.replace(/\s+$/, "")}.`;
}

export function gpBasisNote(basis: GpBasis): string {
  return basis === "dashboard"
    ? "Gross profit here is the dashboard's own measure (sales less quantity at the current purchase price), the same one Sales Performance and Financials use, with closed months held at the margin they were stored with. Switch to SAP recorded GP to see the margin SAP posted on each document."
    : "Gross profit here is the margin SAP posted on each document (its moving-average cost). It will differ from the dashboard GP used on Sales Performance and Financials, which prices cost from the purchase price list.";
}

export function gpNote(p: PerformancePayload): string | null {
  if (!p.labels.cq || !p.labels.pq) return null;
  const drop = materialPrincipals(p)
    .filter((row) => row.cqGpGrowth !== null && row.cqGpGrowth < -10)
    .sort((a, b) => (a.cqGpGrowth as number) - (b.cqGpGrowth as number))[0];
  const parts: string[] = [];
  if (drop) parts.push(`${drop.p}'s ${p.labels.cq} GP fell ${pct(Math.abs(drop.cqGpGrowth as number), 0)} on ${signedPct(drop.cqGrowth)} sales: its margin went from ${pct(drop.pqGpm)} to ${pct(drop.cqGpm)}.`);
  if (p.belowCost.length > 0) {
    const names = p.belowCost.slice(0, 2).map((item) => `${itemLabel(item)} (${kes(item.sales)}, ${pct(item.gpm)} margin)`);
    parts.push(`${names.join(" and ")} ${names.length === 1 ? "is" : "are"} selling below cost and should be checked for pricing or cost errors before the next order cycle.`);
  }
  return parts.length > 0 ? parts.join(" ") : null;
}

export function operationsLede(p: PerformancePayload): string {
  const lead = p.warehouses[0];
  let text = lead ? `${lead.n} is the single largest selling point (${pct(lead.share, 0)} of sales)${lead.cqGrowth !== null && p.labels.cq ? ` and moved ${signedPct(lead.cqGrowth)} in ${p.labels.cq}` : ""}.` : "No warehouse sales yet.";
  if (p.kpi.cnPct !== null) text += ` Credit notes reverse ${pct(p.kpi.cnPct)} of gross invoicing, a rate that varies widely by principal.`;
  return text;
}

export function returnsNote(p: PerformancePayload): string | null {
  const ranked = materialPrincipals(p)
    .filter((row) => row.cnPct !== null)
    .sort((a, b) => (b.cnPct as number) - (a.cnPct as number))
    .slice(0, 4);
  if (ranked.length === 0) return null;
  const monthlyRates = fullScopeRows(p).filter((row) => row.cnPct !== null);
  let text = `${ranked.map((row) => `${row.p} (${pct(row.cnPct, 0)})`).join(", ")} have the highest return rates.`;
  if (monthlyRates.length > 1) {
    const low = monthlyRates.reduce((a, b) => ((b.cnPct as number) < (a.cnPct as number) ? b : a));
    const high = monthlyRates.reduce((a, b) => ((b.cnPct as number) > (a.cnPct as number) ? b : a));
    text += ` Monthly credit notes ranged from ${pct(low.cnPct, 0)} (${monthName(low.m)}) to ${pct(high.cnPct, 0)} (${monthName(high.m)}) of invoicing.`;
  }
  return text;
}

export const repsNote = "Rep-level changes partly reflect route reassignments, so read rep growth together with the territory, not in isolation.";
