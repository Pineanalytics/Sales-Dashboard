"use client";

import { useState } from "react";
import { useDashboardStore } from "@/lib/store";
import { ProfitabilityView } from "@/components/views/ProfitabilityView";
import { PLStatementView } from "@/components/views/PLStatementView";

type ProfitabilityTab = "grossProfit" | "plStatement";

const TABS: { key: ProfitabilityTab; label: string }[] = [
  { key: "grossProfit", label: "Gross Profit & Margin" },
  { key: "plStatement", label: "P&L Statement" },
];

export default function ProfitabilityPage() {
  const [tab, setTab] = useState<ProfitabilityTab>("grossProfit");
  const dataset = useDashboardStore((s) => s.dataset);
  const selectedPrincipalKey = useDashboardStore((s) => s.selectedPrincipalKey);
  const period = useDashboardStore((s) => s.selectedPeriod);
  if (!dataset) return null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap rounded-full bg-background-elevated p-0.5 w-fit">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all duration-300 ${
              tab === t.key
                ? "bg-gradient-to-r from-primary-blue to-secondary-blue text-white shadow-cyan-glow"
                : "text-muted-strong hover:text-primary-blue"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "grossProfit" ? (
        <ProfitabilityView dataset={dataset} selectedPrincipalKey={selectedPrincipalKey} period={period} />
      ) : (
        <PLStatementView dataset={dataset} selectedPrincipalKey={selectedPrincipalKey} period={period} />
      )}
    </div>
  );
}
