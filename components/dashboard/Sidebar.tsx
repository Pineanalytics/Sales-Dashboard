"use client";

import {
  Board20Regular,
  DataLine20Regular,
  PeopleTeam20Regular,
  PersonCircle20Regular,
  ChartMultiple20Regular,
  Money20Regular,
  Box20Regular,
  Dismiss20Regular,
  Broom20Regular,
} from "@fluentui/react-icons";
import type { FluentIcon } from "@fluentui/react-icons";
import { useDashboardStore, VIEW_KEYS, VIEW_LABELS, type ViewKey } from "@/lib/store";
import { principalsByRevenueDesc } from "@/lib/selectors";
import { AchievementBadge } from "@/components/ui/Badge";

const VIEW_ICONS: Record<ViewKey, FluentIcon> = {
  overview: Board20Regular,
  timeIntelligence: DataLine20Regular,
  coverage: PeopleTeam20Regular,
  repPerformance: PersonCircle20Regular,
  customerBrand: ChartMultiple20Regular,
  profitability: Money20Regular,
  stock: Box20Regular,
};

export function Sidebar() {
  const dataset = useDashboardStore((s) => s.dataset);
  const view = useDashboardStore((s) => s.view);
  const setView = useDashboardStore((s) => s.setView);
  const selectedPrincipalKey = useDashboardStore((s) => s.selectedPrincipalKey);
  const selectPrincipal = useDashboardStore((s) => s.selectPrincipal);
  const period = useDashboardStore((s) => s.selectedPeriod);
  const sidebarOpen = useDashboardStore((s) => s.sidebarOpen);
  const setSidebarOpen = useDashboardStore((s) => s.setSidebarOpen);

  const principals = dataset ? principalsByRevenueDesc(dataset, period) : [];

  function handleSelectView(v: ViewKey) {
    setView(v);
    setSidebarOpen(false);
  }

  function handleSelectPrincipal(key: string | null) {
    selectPrincipal(key);
    setSidebarOpen(false);
  }

  return (
    <>
      {sidebarOpen ? (
        <button
          aria-label="Close menu"
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}
      <aside
        className={`fixed z-50 md:z-0 md:static top-0 left-0 h-full md:h-auto w-72 shrink-0 bg-surface flex flex-col transition-transform duration-300 md:translate-x-0 md:shadow-[2px_0_8px_rgba(0,0,0,0.06)] ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-4 py-4 md:hidden">
          <span className="font-semibold text-sm text-primary-blue">Menu</span>
          <button onClick={() => setSidebarOpen(false)} aria-label="Close menu" className="text-muted hover:text-foreground">
            <Dismiss20Regular />
          </button>
        </div>

        <nav className="px-3 pt-4 flex flex-col gap-1">
          {VIEW_KEYS.map((key) => {
            const Icon = VIEW_ICONS[key];
            const active = view === key;
            return (
              <button
                key={key}
                onClick={() => handleSelectView(key)}
                className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all duration-300 ${
                  active
                    ? "bg-gradient-to-r from-primary-blue to-secondary-blue text-white shadow-cyan-glow"
                    : "text-muted-strong hover:bg-accent-blue-soft hover:text-primary-blue"
                }`}
              >
                <span className={active ? "text-white" : "text-secondary-blue"}>
                  <Icon />
                </span>
                {VIEW_LABELS[key]}
              </button>
            );
          })}
        </nav>

        <div className="mt-4 border-t border-border" />

        <div className="px-3 pt-3 pb-1 flex items-center justify-between">
          <span className="text-[13px] font-semibold uppercase tracking-wide text-muted">Principals</span>
          {selectedPrincipalKey ? (
            <button
              onClick={() => handleSelectPrincipal(null)}
              className="flex items-center gap-1 text-xs text-muted hover:text-accent-red transition-colors duration-300"
            >
              <Broom20Regular className="h-3.5 w-3.5" /> Clear
            </button>
          ) : null}
        </div>

        <div className="px-3 pb-3 flex flex-col gap-2 overflow-y-auto flex-1 min-h-0">
          <button
            onClick={() => handleSelectPrincipal(null)}
            className={`flex items-center justify-between rounded-full border px-4 py-2 text-sm font-medium transition-all duration-300 ${
              !selectedPrincipalKey
                ? "bg-gradient-to-r from-primary-blue to-secondary-blue border-transparent text-white shadow-cyan-glow"
                : "bg-surface border-secondary-blue/30 text-muted-strong hover:border-secondary-blue hover:bg-accent-blue-soft"
            }`}
          >
            All Principals
          </button>

          {principals.map((p) => {
            const active = selectedPrincipalKey === p.principalKey;
            const shortName = p.principal.split("-")[0] || p.principal;
            return (
              <button
                key={p.principalKey}
                onClick={() => handleSelectPrincipal(p.principalKey)}
                className={`flex items-center justify-between gap-2 rounded-full border px-4 py-2 text-sm transition-all duration-300 ${
                  active
                    ? "bg-gradient-to-r from-primary-blue to-secondary-blue border-transparent text-white shadow-cyan-glow"
                    : "bg-surface border-border text-muted-strong hover:border-secondary-blue hover:bg-accent-blue-soft"
                }`}
                title={p.principal}
              >
                <span className="truncate">{shortName}</span>
                <AchievementBadge pct={p.achievementPct} />
              </button>
            );
          })}

          {dataset && principals.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted">No principals in this period.</p>
          ) : null}
        </div>
      </aside>
    </>
  );
}
