"use client";

import { O360, fmtKES, fmtNum } from "./theme";

export function Leaderboard({ items }: { items: { name: string; orders: number; value: number }[] }) {
  const max = Math.max(1, ...items.map((i) => i.orders));
  if (items.length === 0) return <div className={`text-[12px] ${O360.textMuted}`}>Nothing to show here yet.</div>;
  return (
    <div className="flex flex-col gap-2">
      {items.map((i) => {
        const pct = Math.max(4, Math.round((i.orders / max) * 100));
        return (
          <div key={i.name} className="grid grid-cols-[minmax(90px,140px)_1fr_auto] items-center gap-2.5">
            <div className="truncate text-[12px] font-medium text-white/85" title={i.name}>{i.name}</div>
            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: O360.accent }} />
            </div>
            <div className={`whitespace-nowrap text-[11px] ${O360.textMuted}`}>{fmtNum(i.orders)} &middot; {fmtKES(i.value, true)}</div>
          </div>
        );
      })}
    </div>
  );
}

export interface DriverLeaderboardItem {
  name: string;
  deliveredOrders: number;
  deliveredValue: number;
  pendingOrders: number;
  pendingValue: number;
  returnsCount: number;
}

export function DriverLeaderboard({ items }: { items: DriverLeaderboardItem[] }) {
  const max = Math.max(1, ...items.map((i) => i.deliveredOrders + i.pendingOrders));
  if (items.length === 0) return <div className={`text-[12px] ${O360.textMuted}`}>No vans with activity in this window.</div>;
  return (
    <div className="flex flex-col gap-3">
      <div className={`flex items-center gap-4 text-[11px] ${O360.textMuted}`}>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: O360.good }} />Delivered</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: O360.warn }} />Pending (not yet delivered)</span>
      </div>
      {items.map((i) => {
        const dPct = max ? (i.deliveredOrders / max) * 100 : 0;
        const pPct = max ? (i.pendingOrders / max) * 100 : 0;
        return (
          <div key={i.name} className="grid grid-cols-[minmax(110px,170px)_1fr_auto] items-center gap-2.5">
            <div className="truncate text-[12px] font-medium text-white/85" title={i.name}>{i.name}</div>
            <div className="flex h-2 overflow-hidden rounded-full bg-white/10">
              <div style={{ width: `${dPct}%`, background: O360.good }} />
              <div style={{ width: `${pPct}%`, background: O360.warn }} />
            </div>
            <div className={`whitespace-nowrap text-right text-[11px] ${O360.textMuted}`}>
              {i.deliveredOrders} done &middot; <span style={{ color: O360.warn }}>{i.pendingOrders} pending</span>
              <br />
              {fmtKES(i.pendingValue, true)} tied up
              {i.returnsCount > 0 ? (
                <span className="ml-1 inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: `${O360.bad}22`, color: O360.bad }}>
                  {i.returnsCount} return{i.returnsCount > 1 ? "s" : ""}
                </span>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
