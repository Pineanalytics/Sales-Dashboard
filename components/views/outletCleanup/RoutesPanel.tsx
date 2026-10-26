"use client";

import { useEffect, useState } from "react";
import { SectionCard } from "@/components/ui/KpiGrid";
import { TableWrap, Td, Th, Thead } from "@/components/ui/Table";
import { formatNumber } from "@/lib/format";
import type { RouteRow } from "@/lib/outletCleanup/routes";
import { RouteBuilder } from "./RouteBuilder";

interface Payload {
  routes: RouteRow[];
  teamLeaders: string[];
  locations: string[];
  canCreate: boolean;
}

const primaryButton = "rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-4 py-1.5 text-xs font-semibold text-white hover:shadow-cyan-glow disabled:opacity-50";
const inputClass = "rounded-full border border-border bg-background-elevated px-4 py-1.5 text-xs outline-none focus:border-primary-blue";

/** The routes the person's teams have named, and naming a new one after the major locations it covers. */
export function RoutesPanel() {
  const [teamLeader, setTeamLeader] = useState("");
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/outlet-cleanup/routes${teamLeader ? `?teamLeader=${encodeURIComponent(teamLeader)}` : ""}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Failed to load the routes.");
        if (!cancelled) {
          setData(body);
          setError(null);
        }
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [teamLeader, tick]);

  if (error) return <SectionCard title="Routes"><p className="text-sm text-muted-strong">{error}</p></SectionCard>;
  if (!data) return <SectionCard title="Routes"><p className="text-sm text-muted">Loading…</p></SectionCard>;

  return (
    <div className="flex flex-col gap-6">
      <SectionCard
        title="Routes"
        action={data.canCreate ? <button className={primaryButton} onClick={() => setNaming(!naming)}>{naming ? "Cancel" : "Name a new route"}</button> : null}
      >
        <p className="text-sm text-muted-strong">
          A route is a named round a rep walks, usually after the major locations it covers (for example Imara Daima-Fedha). Name your routes here or while you validate an outlet, then put each outlet on a route with its visit days in My outlets.
        </p>
        {naming && data.canCreate ? (
          <div className="mt-3">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Team leader</span>
              <select aria-label="Team leader" className={`${inputClass} w-64`} value={teamLeader} onChange={(e) => setTeamLeader(e.target.value)}>
                <option value="">Choose a team leader…</option>
                {data.teamLeaders.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            {teamLeader ? (
              <RouteBuilder
                key={teamLeader}
                teamLeader={teamLeader}
                locations={data.locations}
                onCreated={() => {
                  setNaming(false);
                  setTick((t) => t + 1);
                }}
                onCancel={() => setNaming(false)}
              />
            ) : null}
          </div>
        ) : null}
      </SectionCard>

      <SectionCard title={`Named routes (${formatNumber(data.routes.length)})`}>
        <TableWrap>
          <Thead>
            <Th>Route</Th>
            <Th>Team leader</Th>
            <Th>Major locations</Th>
            <Th align="right">Outlets validated on it</Th>
            <Th>Named by</Th>
          </Thead>
          <tbody>
            {data.routes.map((route) => (
              <tr key={route.id}>
                <Td>{route.name}</Td>
                <Td>{route.teamLeader}</Td>
                <Td>{route.locations.join(", ") || "—"}</Td>
                <Td align="right">{formatNumber(route.outlets)}</Td>
                <Td>{route.createdBy}</Td>
              </tr>
            ))}
            {data.routes.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-muted">No route has been named yet.</td></tr>
            ) : null}
          </tbody>
        </TableWrap>
      </SectionCard>
    </div>
  );
}
