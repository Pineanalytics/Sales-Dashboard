"use client";

import { useEffect, useState } from "react";
import { PersonMoney20Regular } from "@fluentui/react-icons";
import { EmptyState } from "@/components/ui/EmptyState";
import { FullPageSpinner } from "@/components/ui/Spinner";
import { KpiCard } from "@/components/ui/KpiCard";
import { SectionCard } from "@/components/ui/KpiGrid";
import { TableWrap, Thead, Th, Td, TotalRow } from "@/components/ui/Table";
import { formatNumber, formatPercent } from "@/lib/format";
import { useCurrentUser } from "@/components/dashboard/UserContext";

interface Totals {
  revenue: number;
  cases: number;
  grossProfit: number;
  grossMarginPct: number | null;
}
interface MonthlyRow {
  year: string;
  month: string;
  monthIndex: number;
  principal: string;
  revenue: number;
  cases: number;
  grossProfit: number;
}
interface PrincipalTotal {
  principal: string;
  revenue: number;
  cases: number;
  grossProfit: number;
}
interface Summary {
  employee: { employeeCode: string; pineName: string | null; sapName: string | null; absolutePrincipal: string | null; salesRole: string | null; active: boolean };
  totals: Totals;
  ytd: Totals & { year: string | null };
  monthly: MonthlyRow[];
  byPrincipal: PrincipalTotal[];
}

function kes(value: number): string {
  return `KES ${formatNumber(value)}`;
}

/** A logged-in user's own rep-level SAP sales — unlocked by linking their login
 *  to an EmployeeMaster.employeeCode on /admin/users (User.employeeCode),
 *  independent of their Role or allowedPages. Shows just their own figures;
 *  the API route resolves the employeeCode from the session, never a param. */
export function MySalesView() {
  const user = useCurrentUser();
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.employeeCode) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/my-sales/summary", { cache: "no-store" });
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error || "Failed to load your sales summary.");
        if (!cancelled) {
          setData(body as Summary);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load your sales summary.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.employeeCode]);

  if (!user?.employeeCode) {
    return (
      <EmptyState
        icon={<PersonMoney20Regular className="h-10 w-10" />}
        title="Your login isn't linked to a rep profile yet"
        description="Ask an administrator to set your Employee Code on Manage Users to unlock this module."
      />
    );
  }
  if (loading) return <FullPageSpinner label="Loading your sales..." />;
  if (error || !data) {
    return <EmptyState icon={<PersonMoney20Regular className="h-10 w-10" />} title="Couldn't load your sales" description={error ?? "Try refreshing the page."} />;
  }

  const { employee, totals, ytd, monthly, byPrincipal } = data;
  const displayName = employee.pineName ?? employee.sapName ?? user.name ?? "—";

  return (
    <div className="flex flex-col gap-6">
      <SectionCard
        title="My Sales"
        action={
          <span className="text-xs text-muted">
            {displayName} ({employee.employeeCode}) · SAP Name: {employee.sapName ?? "—"}
            {employee.absolutePrincipal ? ` · ${employee.absolutePrincipal}` : ""}
          </span>
        }
      >
        <p className="text-sm text-muted">
          Your own SAP-recorded sales, from the same rep-level ledger used across the dashboard — independent of whatever reports your login otherwise sees.
        </p>
      </SectionCard>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard accent="revenue" label={`${ytd.year ?? "YTD"} revenue`} value={kes(ytd.revenue)} />
        <KpiCard accent="growth" label={`${ytd.year ?? "YTD"} cases`} value={formatNumber(ytd.cases)} />
        <KpiCard accent="quarter" label={`${ytd.year ?? "YTD"} gross profit`} value={kes(ytd.grossProfit)} />
        <KpiCard accent="coverage" label={`${ytd.year ?? "YTD"} GP margin`} value={ytd.grossMarginPct === null ? "—" : formatPercent(ytd.grossMarginPct)} />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard accent="revenue" size="md" label="All-time revenue" value={kes(totals.revenue)} />
        <KpiCard accent="growth" size="md" label="All-time cases" value={formatNumber(totals.cases)} />
        <KpiCard accent="quarter" size="md" label="All-time gross profit" value={kes(totals.grossProfit)} />
        <KpiCard accent="coverage" size="md" label="All-time GP margin" value={totals.grossMarginPct === null ? "—" : formatPercent(totals.grossMarginPct)} />
      </div>

      {byPrincipal.length > 1 ? (
        <SectionCard title="By principal">
          <TableWrap>
            <Thead>
              <Th>Principal</Th>
              <Th align="right">Revenue</Th>
              <Th align="right">Cases</Th>
              <Th align="right">Gross profit</Th>
            </Thead>
            <tbody>
              {byPrincipal.map((row) => (
                <tr key={row.principal}>
                  <Td>{row.principal}</Td>
                  <Td align="right">{kes(row.revenue)}</Td>
                  <Td align="right">{formatNumber(row.cases)}</Td>
                  <Td align="right">{kes(row.grossProfit)}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </SectionCard>
      ) : null}

      <SectionCard title="Monthly history">
        {monthly.length === 0 ? (
          <p className="px-1 py-6 text-center text-sm text-muted">No SAP sales recorded yet for this Employee Code.</p>
        ) : (
          <TableWrap>
            <Thead>
              <Th>Month</Th>
              <Th>Principal</Th>
              <Th align="right">Revenue</Th>
              <Th align="right">Cases</Th>
              <Th align="right">Gross profit</Th>
            </Thead>
            <tbody>
              {monthly.map((row, index) => (
                <tr key={`${row.year}-${row.monthIndex}-${row.principal}-${index}`}>
                  <Td>
                    {row.month} {row.year}
                  </Td>
                  <Td>{row.principal}</Td>
                  <Td align="right">{kes(row.revenue)}</Td>
                  <Td align="right">{formatNumber(row.cases)}</Td>
                  <Td align="right">{kes(row.grossProfit)}</Td>
                </tr>
              ))}
              <TotalRow>
                <Td>Total</Td>
                <Td>—</Td>
                <Td align="right">{kes(totals.revenue)}</Td>
                <Td align="right">{formatNumber(totals.cases)}</Td>
                <Td align="right">{kes(totals.grossProfit)}</Td>
              </TotalRow>
            </tbody>
          </TableWrap>
        )}
      </SectionCard>
    </div>
  );
}
