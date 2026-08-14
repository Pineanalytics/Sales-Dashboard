"use client";

import { useState } from "react";
import { exportToCsv, exportToExcel, exportToPdf, type ReportMeta } from "@/lib/reports/exporters";

interface Accompaniment {
  id: string;
  date: string;
  team_leader_id: string;
  sales_rep_id: string;
  route_id: string | null;
  status: string;
  overall_score: number | null;
  start_time: string | null;
  end_time: string | null;
}
interface Visit {
  id: string;
  accompaniment_id: string;
  outlet_id: string;
  planned: boolean;
  arrival_at: string | null;
  departure_at: string | null;
  distance_from_outlet_m: number | null;
  geofence_status: string | null;
}
interface Action {
  id: string;
  accompaniment_id: string;
  issue: string;
  coaching_area: string | null;
  required_action: string;
  owner_id: string;
  target_date: string | null;
  priority: string;
  status: string;
  evidence_required: boolean;
  evidence_url: string | null;
}
interface Outlet {
  id: string;
  name: string;
  outlet_code: string;
}
interface Profile {
  id: string;
  full_name: string | null;
}
interface Route {
  id: string;
  name: string;
}

export default function ReportsPanel({
  brandName,
  accompaniments,
  visits,
  actions,
  outlets,
  profiles,
  reps,
  routes,
}: {
  brandName: string;
  accompaniments: Accompaniment[];
  visits: Visit[];
  actions: Action[];
  outlets: Outlet[];
  profiles: Profile[];
  reps: Profile[];
  routes: Route[];
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const nameOf = (id: string) => profiles.find((p) => p.id === id)?.full_name ?? "—";
  const repNameOf = (id: string) => reps.find((p) => p.id === id)?.full_name ?? "—";
  const outletOf = (id: string) => outlets.find((o) => o.id === id);
  const routeOf = (id: string | null) => routes.find((r) => r.id === id)?.name ?? "—";
  const accompanimentOf = (id: string) => accompaniments.find((a) => a.id === id);

  function meta(reportTitle: string): ReportMeta {
    return {
      brandName,
      reportTitle,
      reportRef: `RPT-${Date.now()}`,
      generatedAt: new Date().toLocaleString(),
      generatedBy: "System",
    };
  }

  const reports = [
    {
      key: "accompaniment",
      title: "Accompaniment Report",
      headers: ["Date", "Team Leader", "Sales Rep", "Route", "Status", "Score", "Start", "End"],
      rows: accompaniments.map((a) => [
        a.date,
        nameOf(a.team_leader_id),
        repNameOf(a.sales_rep_id),
        routeOf(a.route_id),
        a.status,
        a.overall_score ?? "",
        a.start_time ? new Date(a.start_time).toLocaleTimeString() : "",
        a.end_time ? new Date(a.end_time).toLocaleTimeString() : "",
      ]),
    },
    {
      key: "coaching-score",
      title: "Coaching Score Report",
      headers: ["Date", "Team Leader", "Sales Rep", "Overall Score", "Status"],
      rows: accompaniments
        .filter((a) => a.overall_score != null)
        .map((a) => [a.date, nameOf(a.team_leader_id), repNameOf(a.sales_rep_id), a.overall_score ?? "", a.status]),
    },
    {
      key: "action-plans",
      title: "Action Plan / Overdue Action Report",
      headers: ["Issue", "Coaching Area", "Required Action", "Owner", "Target Date", "Priority", "Status", "Evidence"],
      rows: actions.map((a) => [
        a.issue,
        a.coaching_area ?? "",
        a.required_action,
        repNameOf(a.owner_id),
        a.target_date ?? "",
        a.priority,
        a.status,
        a.evidence_url ? "Uploaded" : a.evidence_required ? "Required — missing" : "N/A",
      ]),
    },
    {
      key: "outlet-visits",
      title: "Outlet Visit Report",
      headers: ["Outlet Code", "Outlet", "Date", "Planned", "Arrival", "Departure", "Geofence"],
      rows: visits.map((v) => {
        const outlet = outletOf(v.outlet_id);
        const acc = accompanimentOf(v.accompaniment_id);
        return [
          outlet?.outlet_code ?? "",
          outlet?.name ?? "",
          acc?.date ?? "",
          v.planned ? "Yes" : "No",
          v.arrival_at ? new Date(v.arrival_at).toLocaleTimeString() : "",
          v.departure_at ? new Date(v.departure_at).toLocaleTimeString() : "",
          v.geofence_status ?? "",
        ];
      }),
    },
    {
      key: "geofence-compliance",
      title: "Geo-Fence Compliance Report",
      headers: ["Outlet Code", "Outlet", "Date", "Distance (m)", "Geofence Status"],
      rows: visits
        .filter((v) => v.geofence_status)
        .map((v) => {
          const outlet = outletOf(v.outlet_id);
          const acc = accompanimentOf(v.accompaniment_id);
          return [
            outlet?.outlet_code ?? "",
            outlet?.name ?? "",
            acc?.date ?? "",
            v.distance_from_outlet_m ?? "",
            v.geofence_status ?? "",
          ];
        }),
    },
  ];

  async function handleExport(report: (typeof reports)[number], format: "csv" | "excel" | "pdf") {
    setBusy(`${report.key}-${format}`);
    const filenameBase = report.title.replace(/\s+/g, "_");
    if (format === "csv") {
      exportToCsv(`${filenameBase}.csv`, report.headers, report.rows);
    } else if (format === "excel") {
      await exportToExcel(`${filenameBase}.xlsx`, report.title, report.headers, report.rows, meta(report.title));
    } else {
      await exportToPdf(`${filenameBase}.pdf`, report.headers, report.rows, meta(report.title));
    }
    setBusy(null);
  }

  return (
    <div className="space-y-4">
      {reports.map((r) => (
        <div key={r.key} className="bg-white border border-[var(--line)] rounded-lg p-4 flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="font-medium text-[var(--ink-900)]">{r.title}</p>
            <p className="text-xs text-[var(--ink-400)]">{r.rows.length} rows</p>
          </div>
          <div className="flex gap-2">
            {(["csv", "excel", "pdf"] as const).map((format) => (
              <button
                key={format}
                disabled={busy === `${r.key}-${format}`}
                onClick={() => handleExport(r, format)}
                className="rounded-md border border-[var(--line)] text-sm font-medium px-3 py-1.5 hover:border-[var(--pine-500)] disabled:opacity-50"
              >
                {busy === `${r.key}-${format}` ? "..." : format.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
