"use client";

import { useEffect, useMemo, useState } from "react";
import { VehicleTruck20Regular } from "@fluentui/react-icons";
import { FullPageSpinner } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { O360, fmtKES, fmtNum } from "@/components/order360/theme";
import { O360Panel, O360KpiCard, O360KpiGrid, O360Callout, O360StatPair } from "@/components/order360/primitives";
import { Leaderboard, DriverLeaderboard } from "@/components/order360/Leaderboard";
import { PipelineTrack } from "@/components/order360/PipelineTrack";
import { BacklogTable, type BacklogRow } from "@/components/order360/BacklogTable";

interface FunnelStage { stage: string; count: number }
interface PerfPerson { name: string; orders: number; value: number }
interface DeliveryDriver {
  name: string;
  deliveredOrders: number;
  deliveredValue: number;
  confirmedOrders: number;
  unconfirmedOrders: number;
  pendingOrders: number;
  pendingValue: number;
  avgAgePending: number;
  maxAgePending: number;
  returnsCount: number;
  returnsValue: number;
}
interface RespBacklogRow { ref: string; date: string; customer: string; fsr: string; amount: number; age: number; owner: string; erpPrefix?: string | null; principal?: string | null; returned?: boolean; returnType?: string | null }
interface ReturnRow { ref: string; date: string; customer: string; fsr: string; type: "Full" | "Partial"; returnDate: string | null; amount: number; owner: string }
interface PaymentRow { ref: string; date: string; customer: string; fsr: string; paymentRef: string; paymentModes: string[]; stkPushStatus: "confirmed" | "pending" | "failed" | "not-requested"; amount: number; amountPaid: number }
interface Mismatch extends PaymentRow { diff: number }
interface VanStk { name: string; orders: number; value: number; totalOrders: number; stkPct: number }
interface Spotlight { name: string; dispatched: number; delivered: number; pending: number; returns: number; returnsValue: number; pendingNonReturn: number }

interface Order360Response {
  meta: { range: string; reportDate: string; totalOrders: number; totalValue: number; podConfirmedPct: number; podConfirmedCount: number; podUnconfirmedCount: number };
  funnel: FunnelStage[];
  perf: { clearance: PerfPerson[]; pick: PerfPerson[]; dispatch: PerfPerson[]; audit: PerfPerson[]; deliveryDrivers: DeliveryDriver[] };
  backlog: { clearance: RespBacklogRow[]; pick: RespBacklogRow[]; dispatch: RespBacklogRow[]; audit: RespBacklogRow[]; delivery: RespBacklogRow[] };
  returns: { totalCount: number; totalValue: number; byType: { type: "Full" | "Partial"; count: number; value: number }[]; people: PerfPerson[]; rows: ReturnRow[]; spotlight: Spotlight | null };
  clearanceAllocation: { erpPrefix: string; principal: string; accountant: string; awaitingOrders: number; awaitingValue: number; clearedOrders: number; clearedValue: number }[];
  payments: { stkCount: number; stkPendingCount: number; stkFailedCount: number; noStkCount: number; stkValueOrdered: number; stkValuePaid: number; mismatchCount: number; mismatches: Mismatch[]; byFsr: PerfPerson[]; byVan: VanStk[]; methods: { method: string; orders: number; value: number }[]; rows: PaymentRow[] };
  availableMonths: string[];
  availableWeeks: string[];
}

type StageKey = "clearance" | "pick" | "dispatch" | "audit";
type TabKey = "overview" | "action" | StageKey | "delivery" | "returns" | "payments";

const STAGE_META: Record<StageKey | "delivery", { label: string; verb: string; gate: string; note: string }> = {
  clearance: { label: "Clearance", verb: "Cleared", gate: "clearance approval", note: "Assigned by the first three ERP digits to the responsible principal accountant." },
  pick: { label: "Picking", verb: "Picked", gate: "picking", note: "Owned by the Picking team — orders sit unassigned until a picker actions them." },
  dispatch: { label: "Dispatch", verb: "Dispatched", gate: "dispatch", note: "Owned by the Dispatch team — orders sit unassigned until a dispatcher actions them." },
  audit: { label: "Audit", verb: "Audited", gate: "audit", note: "Owned by the Audit team — orders sit unassigned until an auditor actions them." },
  delivery: { label: "Delivery", verb: "Delivered", gate: "delivery confirmation", note: "A van is already assigned at dispatch — so every pending row below is attributable to a named van." },
};

const TABS: { key: TabKey; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "action", label: "Action Items" },
  { key: "clearance", label: "Clearance" },
  { key: "pick", label: "Picking" },
  { key: "dispatch", label: "Dispatch" },
  { key: "audit", label: "Audit" },
  { key: "delivery", label: "Delivery" },
  { key: "returns", label: "Returns" },
  { key: "payments", label: "Payments" },
];

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

// <option> background/color isn't reliably picked up from an ancestor's
// color-scheme on every Windows Chrome build - set it explicitly so the
// dropdown popup itself (not just the closed control) stays legible instead
// of falling back to the OS's light list-box chrome under white text.
const OPTION_STYLE: React.CSSProperties = { backgroundColor: O360.panelSoft, color: "#fff" };

function toBacklogRows(rows: RespBacklogRow[], stage?: string): BacklogRow[] {
  return rows.map((r) => ({ ...r, stage }));
}

function ageBuckets(rows: RespBacklogRow[]): { label: string; count: number; color: "good" | "warn" | "bad" }[] {
  let good = 0, warn = 0, bad = 0;
  for (const r of rows) {
    if (r.age <= 2) good++;
    else if (r.age <= 7) warn++;
    else bad++;
  }
  return [
    { label: "0-2d", count: good, color: "good" },
    { label: "3-7d", count: warn, color: "warn" },
    { label: "8d+", count: bad, color: "bad" },
  ];
}

export default function Order360Page() {
  const [status, setStatus] = useState<"loading" | "idle" | "error">("loading");
  const [data, setData] = useState<Order360Response | null>(null);
  const [tab, setTab] = useState<TabKey>("overview");
  const [actionFilter, setActionFilter] = useState<"all" | StageKey | "delivery">("all");

  const [month, setMonth] = useState<string | null>(null);
  const [week, setWeek] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [dayNames, setDayNames] = useState<Set<string>>(new Set());

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (month) params.set("month", month);
    if (month && week) params.set("week", week);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    if (dayNames.size > 0 && dayNames.size < 7) params.set("dayNames", Array.from(dayNames).join(","));

    (async () => {
      try {
        const res = await fetch(`/api/order-360?${params.toString()}`, { cache: "no-store", signal: controller.signal });
        const body = (await res.json()) as Order360Response & { error?: string };
        if (!res.ok) throw new Error(body.error || "Failed to load Order 360 data.");
        if (controller.signal.aborted) return;
        setData(body);
        setStatus("idle");
      } catch (err) {
        if (!controller.signal.aborted) {
          console.error("Failed to load Order 360 data", err);
          setStatus("error");
        }
      }
    })();
    return () => controller.abort();
  }, [month, week, dateFrom, dateTo, dayNames]);

  const jump = (key: string) => setTab(key as TabKey);

  if (status === "loading") return <FullPageSpinner label="Loading Order 360..." />;
  if (status === "error" || !data) {
    return <EmptyState icon={<VehicleTruck20Regular className="h-10 w-10" />} title="Couldn't load Order 360" description="Try refreshing the page. If this keeps happening, the direct-SQL sync may be behind schedule." />;
  }

  const totalBacklog = (["clearance", "pick", "dispatch", "audit"] as StageKey[]).reduce((s, k) => s + data.backlog[k].length, 0) + data.backlog.delivery.length;
  const totalBacklogValue =
    (["clearance", "pick", "dispatch", "audit"] as StageKey[]).reduce((s, k) => s + data.backlog[k].reduce((a, r) => a + r.amount, 0), 0) + data.backlog.delivery.reduce((a, r) => a + r.amount, 0);
  const deliveredCount = data.funnel[data.funnel.length - 1]?.count ?? 0;
  const deliveredPct = data.meta.totalOrders ? Math.round((deliveredCount / data.meta.totalOrders) * 100) : 0;

  const pipelineStages = data.funnel.map((f, idx) => {
    const dropMap: Record<number, { key: StageKey | "delivery"; n: number }> = {
      1: { key: "clearance", n: data.backlog.clearance.length },
      2: { key: "pick", n: data.backlog.pick.length },
      3: { key: "dispatch", n: data.backlog.dispatch.length },
      4: { key: "audit", n: data.backlog.audit.length },
      5: { key: "delivery", n: data.backlog.delivery.length },
    };
    const drop = dropMap[idx];
    return { key: drop?.key ?? f.stage.toLowerCase(), stage: f.stage, count: f.count, dropCount: drop?.n };
  });

  const P = data.payments;
  const paymentsTotalOrders = P.stkCount + P.stkPendingCount + P.stkFailedCount + P.noStkCount;
  const stkPct = paymentsTotalOrders ? Math.round((P.stkCount / paymentsTotalOrders) * 100) : 0;

  const drivers = [...data.perf.deliveryDrivers].sort((a, b) => b.pendingValue - a.pendingValue);
  const topDriver = drivers[0];
  const zeroDeliveryDrivers = drivers.filter((d) => d.deliveredOrders === 0 && d.pendingOrders > 0);

  const actionRows: BacklogRow[] = [
    ...toBacklogRows(data.backlog.clearance, "clearance"),
    ...toBacklogRows(data.backlog.pick, "pick"),
    ...toBacklogRows(data.backlog.dispatch, "dispatch"),
    ...toBacklogRows(data.backlog.audit, "audit"),
    ...toBacklogRows(data.backlog.delivery, "delivery"),
  ];
  const filteredActionRows = actionFilter === "all" ? actionRows : actionRows.filter((r) => r.stage === actionFilter);

  return (
    <div className="order360-scope rounded-2xl p-3 sm:p-5" style={{ background: `linear-gradient(180deg, ${O360.panelSoft}, ${O360.base})`, colorScheme: "dark" }}>
      {/* Header + filters */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: O360.accent, boxShadow: `0 0 0 5px ${O360.accent}22` }} />
            <h1 className="text-xl font-bold tracking-tight text-white">Order Fulfillment Control Tower</h1>
          </div>
          <p className={`mt-1 text-[12px] ${O360.textMuted}`}>Clearance → Pick → Dispatch → Audit → Delivery · live ownership and backlog tracking</p>
        </div>
        <div className="flex flex-wrap items-end gap-2.5">
          <FilterSelect label="Month" value={month ?? ""} onChange={(v) => { setMonth(v || null); setWeek(null); }}>
            <option value="" style={OPTION_STYLE}>All loaded months</option>
            {data.availableMonths.map((m) => <option key={m} value={m} style={OPTION_STYLE}>{m}</option>)}
          </FilterSelect>
          {month ? (
            <FilterSelect label="Week" value={week ?? ""} onChange={(v) => setWeek(v || null)}>
              <option value="" style={OPTION_STYLE}>Whole month</option>
              {data.availableWeeks.map((w) => <option key={w} value={w} style={OPTION_STYLE}>{w}</option>)}
            </FilterSelect>
          ) : null}
          <div className="flex flex-col gap-1">
            <span className={`text-[10px] font-semibold uppercase tracking-wide ${O360.textMuted}`}>Date from</span>
            <input
              type="date"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={(e) => setDateFrom(e.target.value)}
              className="rounded-full border border-white/10 px-3 py-1.5 text-[12px] outline-none"
              style={{ colorScheme: "dark", backgroundColor: O360.panelSoft, color: "#fff" }}
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className={`text-[10px] font-semibold uppercase tracking-wide ${O360.textMuted}`}>Date to</span>
            <input
              type="date"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={(e) => setDateTo(e.target.value)}
              className="rounded-full border border-white/10 px-3 py-1.5 text-[12px] outline-none"
              style={{ colorScheme: "dark", backgroundColor: O360.panelSoft, color: "#fff" }}
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className={`text-[10px] font-semibold uppercase tracking-wide ${O360.textMuted}`}>Day Name</span>
            <div className="flex flex-wrap gap-1">
              {DAY_NAMES.map((d) => {
                const active = dayNames.has(d);
                return (
                  <button
                    key={d}
                    onClick={() => setDayNames((prev) => { const next = new Set(prev); if (next.has(d)) next.delete(d); else next.add(d); return next; })}
                    className="rounded-full px-2 py-1 text-[10px] font-semibold transition-colors"
                    style={active ? { background: O360.accent, color: "#04141c" } : { background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.6)" }}
                  >
                    {d.slice(0, 3)}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-4 flex flex-wrap gap-1.5 border-b border-white/10 pb-3">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="rounded-lg border px-3.5 py-2 text-[12px] font-semibold transition-colors"
            style={tab === t.key ? { background: O360.accent, borderColor: O360.accent, color: "#06231F" } : { borderColor: "rgba(255,255,255,0.10)", background: O360.panel, color: "rgba(255,255,255,0.65)" }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" ? (
        <div className="flex flex-col gap-4">
          <O360KpiGrid>
            <O360KpiCard label="Total Orders" value={fmtNum(data.meta.totalOrders)} sub={`${fmtKES(data.meta.totalValue, true)} total value`} />
            <O360KpiCard label="Fully Delivered" value={fmtNum(deliveredCount)} sub={`${deliveredPct}% of all orders`} accent="good" />
            <O360KpiCard label="Open Backlog" value={fmtNum(totalBacklog)} sub="across 5 gates" accent="warn" />
            <O360KpiCard label="Value Tied Up" value={fmtKES(totalBacklogValue, true)} sub="stuck somewhere in the pipeline" accent="gold" />
            <O360KpiCard label="POD/Payment Confirmed" value={`${data.meta.podConfirmedPct}%`} sub={`${fmtNum(data.meta.podConfirmedCount)} of ${fmtNum(deliveredCount)} delivered orders`} accent="bad" />
          </O360KpiGrid>

          {data.meta.podUnconfirmedCount > 0 ? (
            <div className="rounded-xl border p-3.5 text-[12px]" style={{ background: `${O360.warn}14`, borderColor: `${O360.warn}33`, color: "rgba(255,255,255,0.85)" }}>
              <strong style={{ color: O360.warn }}>Disclaimer:</strong> {fmtNum(data.meta.podUnconfirmedCount)} of the {fmtNum(deliveredCount)} orders marked &quot;Delivered&quot; have no POD or payment record on file — they&apos;re counted as delivered only because they were dispatched with no return logged. This most likely means a <strong>credit sale</strong> (paid outside STK/mobile money) or a <strong>lost/unconfirmed delivery</strong> — Order 360 cannot distinguish the two from Pine&apos;s data alone, so treat this figure as needing manual verification, not a confirmed count.
            </div>
          ) : null}

          <O360Panel title="Pipeline flow" note="Click a drop-off badge to jump to that backlog">
            <PipelineTrack stages={pipelineStages} onJump={jump} />
          </O360Panel>

          {paymentsTotalOrders > 0 ? (
          <O360Panel title="STK payments" note={`${stkPct}% of orders have a confirmed STK push — pending/failed requests are shown separately in Payments`}>
              <O360StatPair doneLabel="STK confirmed" doneCount={P.stkCount} doneValue={P.stkValuePaid} pendingLabel="No confirmed STK" pendingCount={P.stkPendingCount + P.stkFailedCount + P.noStkCount} pendingValue={0} />
              <div className="mt-1 text-[12px] font-semibold text-white/80">STK usage frequency by van</div>
              <div className="mt-2">
                <Leaderboard items={[...P.byVan].sort((a, b) => b.stkPct - a.stkPct).map((v) => ({ name: v.name, orders: v.orders, value: v.totalOrders }))} />
              </div>
            </O360Panel>
          ) : null}

          <O360Panel title="Critical findings" note="Ask Frost for a deeper read on any of these — it can reason over the live numbers, not just template them.">
            <div className="grid gap-3 sm:grid-cols-2">
              {/* Every callout below only renders when it names a real, non-zero
                  finding - an all-zero backlog (e.g. once nearly everything
                  dispatched now counts as Delivered) is good news, not a "0
                  orders worth KES 0" critical finding. */}
              {topDriver && topDriver.pendingOrders > 0 ? (
                <O360Callout tag="Highest value risk" cta={{ label: "View delivery breakdown", onClick: () => jump("delivery") }}>
                  <strong>{topDriver.name}</strong> is carrying {fmtNum(topDriver.pendingOrders)} audited orders worth {fmtKES(topDriver.pendingValue, true)} not yet marked delivered (avg age {topDriver.avgAgePending}d, oldest {topDriver.maxAgePending}d).
                </O360Callout>
              ) : null}
              {deliveredCount > 0 ? (
                <O360Callout tag="Confirmation gap" tone="warn">
                  {data.meta.podConfirmedPct === 0
                    ? `All ${fmtNum(deliveredCount)} orders marked "Delivered" have no POD/payment confirmation — likely credit sales or unconfirmed deliveries; verify manually.`
                    : `${fmtNum(data.meta.podUnconfirmedCount)} of the ${fmtNum(deliveredCount)} orders marked "Delivered" (${data.meta.podConfirmedPct}% confirmed) have no POD/payment record — likely credit sales or unconfirmed/lost deliveries; verify manually.`}
                </O360Callout>
              ) : null}
              {zeroDeliveryDrivers.length > 0 ? (
                <O360Callout tag="No delivery closed, ever" tone="info" cta={{ label: "View delivery breakdown", onClick: () => jump("delivery") }}>
                  {zeroDeliveryDrivers.length} van(s) ({zeroDeliveryDrivers.map((d) => d.name).join(", ")}) have not closed a single delivery this window despite carrying {fmtNum(zeroDeliveryDrivers.reduce((s, d) => s + d.pendingOrders, 0))} assigned orders.
                </O360Callout>
              ) : null}
              {data.backlog.delivery.length > 0 ? (
                <O360Callout tag="Largest single gate" cta={{ label: "Open action list", onClick: () => jump("action") }}>
                  The biggest bottleneck by volume is <strong>delivery confirmation</strong>: {fmtNum(data.backlog.delivery.length)} orders ({fmtKES(data.backlog.delivery.reduce((s, r) => s + r.amount, 0), true)}) are audited and out for delivery but not yet closed out.
                </O360Callout>
              ) : null}
              {data.returns.spotlight ? (
                <O360Callout tag={data.returns.spotlight.name} tone="info" cta={{ label: "View returns", onClick: () => jump("returns") }}>
                  Of {fmtNum(data.returns.spotlight.pending)} orders not yet marked delivered, {fmtNum(data.returns.spotlight.returns)} are logged returns worth {fmtKES(data.returns.spotlight.returnsValue, true)} — {fmtNum(data.returns.spotlight.pendingNonReturn)} order(s) are genuinely still in transit.
                </O360Callout>
              ) : null}
              {!(topDriver && topDriver.pendingOrders > 0) && deliveredCount === 0 && zeroDeliveryDrivers.length === 0 && data.backlog.delivery.length === 0 && !data.returns.spotlight ? (
                <div className={`text-[12px] ${O360.textMuted} sm:col-span-2`}>No notable findings for this window — nothing stuck, nothing unconfirmed, nothing to flag.</div>
              ) : null}
            </div>
          </O360Panel>
        </div>
      ) : null}

      {tab === "action" ? (
        <O360Panel title="All open action items" note={`${fmtNum(actionRows.length)} orders waiting on someone, ${fmtKES(actionRows.reduce((s, r) => s + r.amount, 0), true)} total`}>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {(["all", "clearance", "pick", "dispatch", "audit", "delivery"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setActionFilter(k)}
                className="rounded-full px-3 py-1 text-[11px] font-semibold"
                style={actionFilter === k ? { background: O360.accent, color: "#04141c" } : { background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.65)" }}
              >
                {k === "all" ? "All" : `${STAGE_META[k].label} (${data.backlog[k].length})`}
              </button>
            ))}
          </div>
          <BacklogTable rows={filteredActionRows} showStage showOwner stageLabel={(s) => STAGE_META[s as StageKey | "delivery"]?.label ?? s} />
        </O360Panel>
      ) : null}

      {(["clearance", "pick", "dispatch", "audit"] as StageKey[]).includes(tab as StageKey) ? (
        <StagePanel stageKey={tab as StageKey} backlog={data.backlog[tab as StageKey]} perf={data.perf[tab as StageKey]} clearanceAllocation={tab === "clearance" ? data.clearanceAllocation : undefined} />
      ) : null}

      {tab === "delivery" ? (
        <div className="flex flex-col gap-4">
          <O360Panel title="Delivery" note={STAGE_META.delivery.note}>
            <O360StatPair
              doneLabel="Delivered"
              doneCount={drivers.reduce((s, d) => s + d.deliveredOrders, 0)}
              doneValue={drivers.reduce((s, d) => s + d.deliveredValue, 0)}
              pendingLabel="Awaiting delivery confirmation"
              pendingCount={data.backlog.delivery.length}
              pendingValue={data.backlog.delivery.reduce((s, r) => s + r.amount, 0)}
            />
            {data.backlog.delivery.some((r) => r.returned) ? (
              <div className={`mb-1 text-[11px] ${O360.textMuted}`}>
                {fmtNum(data.backlog.delivery.filter((r) => r.returned).length)} of the orders above are already logged as <strong className="text-white/80">returns</strong>, not goods still in transit — see the Returns tab.
              </div>
            ) : null}
            {data.meta.podUnconfirmedCount > 0 ? (
              <div className="mt-2 rounded-lg border p-2.5 text-[11px]" style={{ background: `${O360.warn}14`, borderColor: `${O360.warn}33`, color: "rgba(255,255,255,0.8)" }}>
                <strong style={{ color: O360.warn }}>Disclaimer:</strong> {fmtNum(data.meta.podUnconfirmedCount)} delivered order(s) here have no POD or payment record — counted as delivered only because they were dispatched with no return logged. Likely a credit sale or an unconfirmed/lost delivery; verify manually (flagged &quot;unconfirmed&quot; per-van below).
              </div>
            ) : null}
          </O360Panel>

          <O360Panel title="Van leaderboard" note="Sorted by value still pending">
            <DriverLeaderboard items={drivers} />
          </O360Panel>

          <O360Panel title="Pending deliveries" note='Filter by van using search — "Returned" status flags orders already logged as returns'>
            <BacklogTable rows={toBacklogRows(data.backlog.delivery)} showOwner showReturnStatus />
          </O360Panel>
        </div>
      ) : null}

      {tab === "returns" ? (
        <div className="flex flex-col gap-4">
          {data.returns.totalCount === 0 ? (
            <O360Panel title="Returns"><div className={`text-[12px] ${O360.textMuted}`}>No returns logged in this window.</div></O360Panel>
          ) : (
            <>
              <O360KpiGrid>
                <O360KpiCard label="Total Returns" value={fmtNum(data.returns.totalCount)} sub={fmtKES(data.returns.totalValue, true)} accent="bad" />
                <O360KpiCard label="Full Returns" value={fmtNum(data.returns.byType.find((t) => t.type === "Full")?.count ?? 0)} sub={fmtKES(data.returns.byType.find((t) => t.type === "Full")?.value ?? 0, true)} />
                <O360KpiCard label="Partial Returns" value={fmtNum(data.returns.byType.find((t) => t.type === "Partial")?.count ?? 0)} sub={fmtKES(data.returns.byType.find((t) => t.type === "Partial")?.value ?? 0, true)} />
                <O360KpiCard label="People Involved" value={fmtNum(data.returns.people.length)} sub="handlers processing returns" />
              </O360KpiGrid>

              {data.returns.spotlight ? (
                <O360Panel title="Spotlight">
                  <div className="mb-2 text-[13px] font-semibold text-white">{data.returns.spotlight.name}</div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <Stat label="Dispatched" value={fmtNum(data.returns.spotlight.dispatched)} />
                    <Stat label="Delivered" value={fmtNum(data.returns.spotlight.delivered)} />
                    <Stat label="Not Yet Delivered" value={fmtNum(data.returns.spotlight.pending)} />
                    <Stat label="Of Which Returns" value={fmtNum(data.returns.spotlight.returns)} />
                    <Stat label="Return Value" value={fmtKES(data.returns.spotlight.returnsValue, true)} />
                    <Stat label="Still In Transit" value={fmtNum(data.returns.spotlight.pendingNonReturn)} />
                  </div>
                  <p className={`mt-2 text-[12px] ${O360.textMuted}`}>
                    {data.returns.spotlight.pendingNonReturn === 0
                      ? `Every outstanding order is accounted for — all ${fmtNum(data.returns.spotlight.pending)} are logged returns, not goods still out for delivery.`
                      : `${fmtNum(data.returns.spotlight.pendingNonReturn)} order(s) are still genuinely in transit, separate from the ${fmtNum(data.returns.spotlight.returns)} logged returns.`}
                  </p>
                </O360Panel>
              ) : null}

              <O360Panel title="Returns by van">
                <Leaderboard items={data.returns.people} />
              </O360Panel>

              <O360Panel title="All returned orders">
                <BacklogTable rows={data.returns.rows.map((r) => ({ ref: r.ref, date: r.date, customer: r.customer, fsr: r.fsr, amount: r.amount, age: 0, owner: r.owner, returned: true, returnType: r.type }))} showOwner showReturnStatus={false} />
              </O360Panel>
            </>
          )}
        </div>
      ) : null}

      {tab === "payments" ? (
        <div className="flex flex-col gap-4">
          {paymentsTotalOrders === 0 ? (
            <O360Panel title="Payments"><div className={`text-[12px] ${O360.textMuted}`}>No payment data in this window.</div></O360Panel>
          ) : (
            <>
              <O360Panel title="Payments (STK Push)" note={`${fmtNum(P.stkCount)} confirmed STK pushes; pending and failed requests are kept separate`}>
                <O360KpiGrid>
                  <O360KpiCard label="STK Paid" value={fmtNum(P.stkCount)} sub={`${fmtKES(P.stkValuePaid, true)} received`} accent="good" />
                  <O360KpiCard label="STK Pending" value={fmtNum(P.stkPendingCount)} sub="awaiting customer completion" accent="warn" />
                  <O360KpiCard label="STK Failed" value={fmtNum(P.stkFailedCount)} sub="requires a retry or another option" accent="bad" />
                  <O360KpiCard label="No STK Request" value={fmtNum(P.noStkCount)} sub={`${stkPct}% of orders paid via STK`} />
                  <O360KpiCard label="Ordered vs Paid" value={fmtKES(P.stkValuePaid, true)} sub={`of ${fmtKES(P.stkValueOrdered, true)} ordered on STK orders`} />
                  <O360KpiCard label="Amount Mismatches" value={fmtNum(P.mismatchCount)} sub={`${fmtKES(Math.abs(P.stkValueOrdered - P.stkValuePaid), true)} net gap`} accent={P.mismatchCount > 0 ? "bad" : "good"} />
                </O360KpiGrid>
              </O360Panel>

              <O360Panel title="Confirmed payment options" note="All confirmed payment methods recorded against the selected orders">
                <Leaderboard items={P.methods.map((method) => ({ name: method.method.replaceAll("_", " "), orders: method.orders, value: method.value }))} />
              </O360Panel>

              <O360Panel title="STK collections by FSR">
                <Leaderboard items={P.byFsr} />
              </O360Panel>

              <O360Panel title="Amount Paid vs Order Amount mismatches" note={`${fmtNum(P.mismatchCount)} orders where Amount Paid differs from Amount by more than KES 1`}>
                {P.mismatches.length === 0 ? (
                  <div className={`text-[12px] ${O360.textMuted}`}>No mismatches — every STK payment matches its order amount.</div>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-white/10">
                    <table className="w-full min-w-[720px] text-left text-[12px]">
                      <thead>
                        <tr className="border-b border-white/10 bg-white/[0.04] text-white/60">
                          <th className="px-3 py-2 font-semibold">Order Ref</th><th className="px-3 py-2 font-semibold">Date</th><th className="px-3 py-2 font-semibold">Customer</th><th className="px-3 py-2 font-semibold">FSR</th><th className="px-3 py-2 font-semibold">Payment Ref</th><th className="px-3 py-2 font-semibold">Amount</th><th className="px-3 py-2 font-semibold">Amount Paid</th><th className="px-3 py-2 font-semibold">Diff</th>
                        </tr>
                      </thead>
                      <tbody>
                        {P.mismatches.slice(0, 300).map((r) => (
                          <tr key={r.ref} className="border-b border-white/[0.06] last:border-0 text-white/80">
                            <td className="whitespace-nowrap px-3 py-2">{r.ref}</td>
                            <td className="whitespace-nowrap px-3 py-2">{r.date}</td>
                            <td className="max-w-[200px] truncate px-3 py-2" title={r.customer}>{r.customer}</td>
                            <td className="whitespace-nowrap px-3 py-2">{r.fsr}</td>
                            <td className="whitespace-nowrap px-3 py-2">{r.paymentRef}</td>
                            <td className="whitespace-nowrap px-3 py-2">{fmtKES(r.amount)}</td>
                            <td className="whitespace-nowrap px-3 py-2">{fmtKES(r.amountPaid)}</td>
                            <td className="whitespace-nowrap px-3 py-2 font-semibold" style={{ color: r.diff < 0 ? O360.bad : O360.good }}>{r.diff > 0 ? "+" : ""}{fmtKES(r.diff)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </O360Panel>

              <O360Panel title="STK usage frequency by van">
                <Leaderboard items={[...P.byVan].sort((a, b) => b.stkPct - a.stkPct).map((v) => ({ name: v.name, orders: v.orders, value: v.totalOrders }))} />
              </O360Panel>

              <O360Panel title="All STK payments">
                <div className="overflow-x-auto rounded-lg border border-white/10">
                  <table className="w-full min-w-[640px] text-left text-[12px]">
                    <thead>
                      <tr className="border-b border-white/10 bg-white/[0.04] text-white/60">
                        <th className="px-3 py-2 font-semibold">Order Ref</th><th className="px-3 py-2 font-semibold">Date</th><th className="px-3 py-2 font-semibold">Customer</th><th className="px-3 py-2 font-semibold">FSR</th><th className="px-3 py-2 font-semibold">Payment Ref</th><th className="px-3 py-2 font-semibold">Amount</th><th className="px-3 py-2 font-semibold">Amount Paid</th>
                      </tr>
                    </thead>
                    <tbody>
                      {P.rows.slice(0, 300).map((r) => (
                        <tr key={r.ref} className="border-b border-white/[0.06] last:border-0 text-white/80">
                          <td className="whitespace-nowrap px-3 py-2">{r.ref}</td>
                          <td className="whitespace-nowrap px-3 py-2">{r.date}</td>
                          <td className="max-w-[200px] truncate px-3 py-2" title={r.customer}>{r.customer}</td>
                          <td className="whitespace-nowrap px-3 py-2">{r.fsr}</td>
                          <td className="whitespace-nowrap px-3 py-2">{r.paymentRef}</td>
                          <td className="whitespace-nowrap px-3 py-2">{fmtKES(r.amount)}</td>
                          <td className="whitespace-nowrap px-3 py-2">{fmtKES(r.amountPaid)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className={`mt-1.5 text-[11px] ${O360.textFaint}`}>Showing {fmtNum(Math.min(P.rows.length, 300))} of {fmtNum(P.rows.length)} payments.</div>
              </O360Panel>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function FilterSelect({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className={`text-[10px] font-semibold uppercase tracking-wide ${O360.textMuted}`}>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-full border border-white/10 px-3 py-1.5 text-[12px] font-semibold outline-none"
        style={{ colorScheme: "dark", backgroundColor: O360.panelSoft, color: "#fff" }}
      >
        {children}
      </select>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
      <div className={`text-[10px] font-semibold uppercase tracking-wide ${O360.textMuted}`}>{label}</div>
      <div className="mt-0.5 text-sm font-bold text-white">{value}</div>
    </div>
  );
}

function StagePanel({ stageKey, backlog, perf, clearanceAllocation }: { stageKey: StageKey; backlog: RespBacklogRow[]; perf: PerfPerson[]; clearanceAllocation?: Order360Response["clearanceAllocation"] }) {
  const meta = STAGE_META[stageKey];
  const doneCount = perf.reduce((s, p) => s + p.orders, 0);
  const doneValue = perf.reduce((s, p) => s + p.value, 0);
  const pendingValue = backlog.reduce((s, r) => s + r.amount, 0);
  const buckets = useMemo(() => ageBuckets(backlog), [backlog]);
  const maxBucket = Math.max(1, ...buckets.map((b) => b.count));

  return (
    <div className="flex flex-col gap-4">
      <O360Panel title={meta.label} note={meta.note}>
        <O360StatPair doneLabel={meta.verb} doneCount={doneCount} doneValue={doneValue} pendingLabel={`Awaiting ${meta.gate}`} pendingCount={backlog.length} pendingValue={pendingValue} />
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <div className="mb-2 text-[12px] font-semibold text-white/80">Who has {meta.verb.toLowerCase()}</div>
            <Leaderboard items={perf} />
          </div>
          <div>
            <div className="mb-2 text-[12px] font-semibold text-white/80">Backlog age profile</div>
            <div className="flex flex-col gap-2">
              {buckets.map((b) => {
                const color = b.color === "good" ? O360.good : b.color === "warn" ? O360.warn : O360.bad;
                const pct = Math.max(4, Math.round((b.count / maxBucket) * 100));
                return (
                  <div key={b.label} className="grid grid-cols-[50px_1fr_auto] items-center gap-2.5">
                    <div className="text-[12px] font-medium text-white/85">{b.label}</div>
                    <div className="h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} /></div>
                    <div className={`text-[11px] ${O360.textMuted}`}>{b.count} orders</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </O360Panel>

      <O360Panel title={`Pending orders — ${meta.label.toLowerCase()}`}>
        <BacklogTable rows={toBacklogRows(backlog)} showClearanceAssignment={stageKey === "clearance"} />
      </O360Panel>

      {clearanceAllocation ? (
        <O360Panel title="Clearance allocation" note="ERP # prefix determines the principal and accountable accountant">
          <div className="overflow-x-auto rounded-lg border border-white/10">
            <table className="w-full min-w-[760px] text-left text-[12px]">
              <thead><tr className="border-b border-white/10 bg-white/[0.04] text-white/60"><th className="px-3 py-2">ERP #</th><th className="px-3 py-2">Principal</th><th className="px-3 py-2">Accountant</th><th className="px-3 py-2 text-right">Awaiting</th><th className="px-3 py-2 text-right">Awaiting value</th><th className="px-3 py-2 text-right">Cleared</th></tr></thead>
              <tbody>{clearanceAllocation.map((row) => <tr key={row.erpPrefix} className="border-b border-white/[0.06] last:border-0 text-white/80"><td className="px-3 py-2 font-mono">{row.erpPrefix}</td><td className="px-3 py-2">{row.principal}</td><td className="px-3 py-2 font-semibold">{row.accountant}</td><td className="px-3 py-2 text-right">{fmtNum(row.awaitingOrders)}</td><td className="px-3 py-2 text-right">{fmtKES(row.awaitingValue, true)}</td><td className="px-3 py-2 text-right">{fmtNum(row.clearedOrders)}</td></tr>)}</tbody>
            </table>
          </div>
        </O360Panel>
      ) : null}
    </div>
  );
}
