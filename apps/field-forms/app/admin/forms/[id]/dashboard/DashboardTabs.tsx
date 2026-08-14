"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { DashboardData } from "./dashboardTypes";
import { DASH_COLORS, DASH_PALETTE } from "./charts/ChartSetup";
import { BarChart } from "./charts/BarChart";
import { PieChart } from "./charts/PieChart";
import { Badge, Card, ChartWrap, DataTable, Grid2, KpiTile } from "./charts/DashboardKit";
import { PhotoGrid } from "./PhotoGrid";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "teams", label: "Merchandisers & Retailers" },
  { id: "regions", label: "Regions" },
  { id: "oos", label: "OOS Log" },
  { id: "raw", label: "Visit Records" },
  { id: "photos", label: "Photos" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function pct(n: number | null): string {
  return n !== null ? `${n.toFixed(1)}%` : "—";
}

function OosBadge({ v }: { v: string }) {
  if (!v) return <>—</>;
  return <Badge tone={v === "Yes" ? "critical" : "good"}>{v}</Badge>;
}

function DeliveryBadge({ v }: { v: string }) {
  if (!v) return <>—</>;
  return <Badge tone={v === "Order Delivered" ? "good" : "warning"}>{v}</Badge>;
}

export default function DashboardTabs({ data }: { data: DashboardData }) {
  const [tab, setTab] = useState<TabId>("overview");

  return (
    <div>
      <p className="text-sm mb-6" style={{ color: DASH_COLORS.muted }}>
        {data.kpis.totalVisits} store visits across {data.kpis.retailers}{" "}
        retailers, {data.kpis.branches} branches and {data.kpis.regions} regions
        · {data.kpis.dateRangeLabel}
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3.5 mb-7">
        <KpiTile label="Total Visits" value={String(data.kpis.totalVisits)} color={DASH_COLORS.navy} />
        <KpiTile label="Avg Share of Shelf" value={pct(data.kpis.avgSos)} color={DASH_COLORS.blue} />
        <KpiTile label="OOS Rate" value={`${data.kpis.oosRatePct}%`} color={DASH_COLORS.red} />
        <KpiTile
          label="Avg Positioning"
          value={data.kpis.avgPos !== null ? `${data.kpis.avgPos.toFixed(2)} / 5` : "—"}
          color={DASH_COLORS.green}
        />
        <KpiTile label="Delivery Rate" value={`${data.kpis.deliveryRatePct}%`} color={DASH_COLORS.amber} />
        <KpiTile label="Competitor Activity" value={`${data.kpis.competitorRatePct}%`} color={DASH_COLORS.dark} />
      </div>

      <div
        className="flex gap-1.5 mb-4.5 flex-wrap"
        style={{ borderBottom: `2px solid ${DASH_COLORS.border}` }}
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="px-4 py-2.5 text-sm font-semibold bg-transparent -mb-0.5"
            style={{
              color: tab === t.id ? DASH_COLORS.navy : "#6b7280",
              borderBottom: `3px solid ${tab === t.id ? DASH_COLORS.blue : "transparent"}`,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && <OverviewPanel data={data} />}
      {tab === "teams" && <TeamsPanel data={data} />}
      {tab === "regions" && <RegionsPanel data={data} />}
      {tab === "oos" && <OosPanel data={data} />}
      {tab === "raw" && <RawPanel data={data} />}
      {tab === "photos" && (
        <Card title={`Shelf photos (${data.photos.length})`}>
          <PhotoGrid photos={data.photos} formId={data.formId} />
        </Card>
      )}
    </div>
  );
}

function OverviewPanel({ data }: { data: DashboardData }) {
  return (
    <Grid2>
      <Card title="Visits Logged by Day">
        <ChartWrap>
          <BarChart
            labels={data.dailyVisits.map((d) => d.date)}
            values={data.dailyVisits.map((d) => d.count)}
            label="Visits"
            color={DASH_COLORS.blue}
          />
        </ChartWrap>
      </Card>
      <Card title="Product Positioning Score Distribution">
        <ChartWrap>
          <BarChart
            labels={data.posDist.map((d) => d.label)}
            values={data.posDist.map((d) => d.count)}
            label="Visits"
            color={DASH_COLORS.green}
          />
        </ChartWrap>
      </Card>
      <Card title="Purchase Order Status">
        <ChartWrap>
          <PieChart
            labels={data.poDist.map((d) => d.label)}
            values={data.poDist.map((d) => d.count)}
            colors={DASH_PALETTE}
          />
        </ChartWrap>
      </Card>
      <Card title="Delivery Status">
        <ChartWrap>
          <PieChart
            labels={data.deliveryDist.map((d) => d.label)}
            values={data.deliveryDist.map((d) => d.count)}
            colors={[DASH_COLORS.green, DASH_COLORS.red]}
          />
        </ChartWrap>
      </Card>
    </Grid2>
  );
}

function summaryTable(rows: DashboardData["merch"], nameHeader: string) {
  return (
    <DataTable
      headers={[
        nameHeader,
        "Visits",
        "Avg SoS %",
        "Avg Shelf Occ %",
        "OOS Incidents",
        "OOS Rate",
        "Avg Positioning",
        "Delivery Rate",
      ]}
      rows={rows.map((r) => [
        r.linkHref ? (
          <Link href={r.linkHref} className="font-medium hover:underline" style={{ color: DASH_COLORS.blue }}>
            {r.name}
          </Link>
        ) : (
          r.name
        ),
        r.visits,
        pct(r.avgSos),
        r.avgShelfOcc !== null ? `${Math.round(r.avgShelfOcc)}%` : "—",
        r.oos,
        `${r.oosRatePct}%`,
        r.avgPos !== null ? r.avgPos.toFixed(2) : "—",
        `${r.deliveryRatePct}%`,
      ])}
    />
  );
}

function TeamsPanel({ data }: { data: DashboardData }) {
  return (
    <>
      <Grid2>
        <Card title="Avg Share of Shelf % by Merchandiser">
          <ChartWrap>
            <BarChart
              labels={data.merch.map((m) => m.name)}
              values={data.merch.map((m) => m.avgSos ?? 0)}
              label="Avg SoS %"
              color={DASH_COLORS.blue}
            />
          </ChartWrap>
        </Card>
        <Card title="OOS Rate % by Merchandiser">
          <ChartWrap>
            <BarChart
              labels={data.merch.map((m) => m.name)}
              values={data.merch.map((m) => m.oosRatePct)}
              label="OOS Rate %"
              color={DASH_COLORS.red}
            />
          </ChartWrap>
        </Card>
      </Grid2>

      <Card title="Merchandiser Performance Summary">
        {summaryTable(data.merch, "Merchandiser")}
      </Card>

      <Grid2>
        <Card title="Visit Share by Retailer">
          <ChartWrap>
            <PieChart
              labels={data.retailer.map((r) => r.name)}
              values={data.retailer.map((r) => r.visits)}
              colors={DASH_PALETTE}
            />
          </ChartWrap>
        </Card>
        <Card title="Avg Share of Shelf % by Retailer">
          <ChartWrap>
            <BarChart
              labels={data.retailer.map((r) => r.name)}
              values={data.retailer.map((r) => r.avgSos ?? 0)}
              label="Avg SoS %"
              color={DASH_COLORS.blue}
              horizontal
            />
          </ChartWrap>
        </Card>
      </Grid2>

      <Card title="Retailer Performance Summary">
        {summaryTable(data.retailer, "Retailer")}
      </Card>
    </>
  );
}

function RegionsPanel({ data }: { data: DashboardData }) {
  return (
    <>
      <Grid2>
        <Card title="Avg Share of Shelf % by Region">
          <ChartWrap>
            <BarChart
              labels={data.region.map((r) => r.name)}
              values={data.region.map((r) => r.avgSos ?? 0)}
              label="Avg SoS %"
              color={DASH_COLORS.blue}
            />
          </ChartWrap>
        </Card>
        <Card title="OOS Rate % by Region">
          <ChartWrap>
            <BarChart
              labels={data.region.map((r) => r.name)}
              values={data.region.map((r) => r.oosRatePct)}
              label="OOS Rate %"
              color={DASH_COLORS.red}
            />
          </ChartWrap>
        </Card>
      </Grid2>
      <Card title="Region Performance Summary">
        {summaryTable(data.region, "Region")}
      </Card>
    </>
  );
}

function OosPanel({ data }: { data: DashboardData }) {
  return (
    <Card title={`Out-of-Stock Incidents (${data.oosLog.length} of ${data.kpis.totalVisits} visits)`}>
      <DataTable
        headers={["Date", "Merchandiser", "Retailer", "Branch", "Region", "Items Reported"]}
        rows={data.oosLog.map((r) => [
          r.date,
          r.merchandiser,
          r.retailer,
          r.branch,
          r.region,
          r.itemsReported,
        ])}
      />
    </Card>
  );
}

function RawPanel({ data }: { data: DashboardData }) {
  const [fMerch, setFMerch] = useState("");
  const [fRetailer, setFRetailer] = useState("");
  const [fRegion, setFRegion] = useState("");
  const [fOos, setFOos] = useState("");
  const [fBranch, setFBranch] = useState("");

  const merchOptions = useMemo(
    () => [...new Set(data.rawRows.map((r) => r.merchandiser))].filter(Boolean).sort(),
    [data.rawRows]
  );
  const retailerOptions = useMemo(
    () => [...new Set(data.rawRows.map((r) => r.retailer))].filter(Boolean).sort(),
    [data.rawRows]
  );
  const regionOptions = useMemo(
    () => [...new Set(data.rawRows.map((r) => r.region))].filter(Boolean).sort(),
    [data.rawRows]
  );

  const filtered = useMemo(() => {
    const branchQuery = fBranch.trim().toLowerCase();
    return data.rawRows.filter(
      (r) =>
        (!fMerch || r.merchandiser === fMerch) &&
        (!fRetailer || r.retailer === fRetailer) &&
        (!fRegion || r.region === fRegion) &&
        (!fOos || r.oos === fOos) &&
        (!branchQuery || r.branch.toLowerCase().includes(branchQuery))
    );
  }, [data.rawRows, fMerch, fRetailer, fRegion, fOos, fBranch]);

  const selectClass =
    "px-2.5 py-1.5 text-sm rounded-md bg-white";
  const selectStyle = { border: `1px solid ${DASH_COLORS.border}` };

  return (
    <Card title="">
      <div className="flex flex-wrap gap-2.5 mb-3.5">
        <select className={selectClass} style={selectStyle} value={fMerch} onChange={(e) => setFMerch(e.target.value)}>
          <option value="">All Merchandisers</option>
          {merchOptions.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <select className={selectClass} style={selectStyle} value={fRetailer} onChange={(e) => setFRetailer(e.target.value)}>
          <option value="">All Retailers</option>
          {retailerOptions.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <select className={selectClass} style={selectStyle} value={fRegion} onChange={(e) => setFRegion(e.target.value)}>
          <option value="">All Regions</option>
          {regionOptions.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <select className={selectClass} style={selectStyle} value={fOos} onChange={(e) => setFOos(e.target.value)}>
          <option value="">OOS: All</option>
          <option value="Yes">OOS: Yes</option>
          <option value="No">OOS: No</option>
        </select>
        <input
          type="text"
          placeholder="Search branch…"
          value={fBranch}
          onChange={(e) => setFBranch(e.target.value)}
          className={selectClass}
          style={selectStyle}
        />
      </div>

      <DataTable
        headers={[
          "Date", "Time", "Merchandiser", "Retailer", "Region", "Branch",
          "SoS %", "OOS", "Competitor", "SKUs", "Shelf Occ %", "Positioning",
          "PO Status", "Delivery",
        ]}
        rows={filtered.map((r) => [
          r.date,
          r.time,
          r.merchandiser,
          r.retailer,
          r.region,
          r.branch,
          r.sosPct !== null ? `${r.sosPct.toFixed(1)}%` : "—",
          <OosBadge key="oos" v={r.oos} />,
          <OosBadge key="comp" v={r.competitor} />,
          r.skuCount,
          r.shelfOccPct !== null ? `${Math.round(r.shelfOccPct)}%` : "—",
          r.positioning || "—",
          r.poStatus || "—",
          <DeliveryBadge key="delivery" v={r.delivery} />,
        ])}
      />
    </Card>
  );
}
