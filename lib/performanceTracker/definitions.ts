// Metric/section definitions for both Performance Tracker types, transcribed
// field-for-field from the two source workbooks the module was built from:
//   HOD  -> "HEAD OF SALES REVIEW-Suntory.xlsx", sheet "MD Performance Review"
//   TL   -> "Sales Perfomance Tracker-Suntory.xlsx", sheet "Monthly KPIs"
//           (team-level; "Rep Scorecard" is the separate per-rep grid — see
//           lib/performanceTracker/scoring.ts's computeRepScore)
// Both workbooks' own Instructions tabs documented weights/formulas exactly;
// those are reproduced in the per-metric `weight`/`invert` fields below and in
// scoring.ts, not re-derived. "Add additional if need be" (the ask this was
// built from) means adding a row here — no schema change needed, since
// PerformanceTrackerMetric is itself just (metricKey, target, actual) rows.

// "Calls Planned" deliberately has no auto-source: this dashboard has no
// reliable live schedule to pull from (see the JP Adherence page's own
// history this session — an uploaded Journey Plan's exact-day match rate was
// ~4%, unusable). Calls Made/Productive Calls are the real thing, straight
// from RepCall.
export type AutoSourceKey =
  | "revenueActual"
  | "gpActual"
  | "totalOutletUniverse"
  | "outletsWithDistribution"
  | "callsMade"
  | "productiveCalls"
  | "activeSalesReps";

export interface MetricDefinition {
  key: string;
  label: string;
  unit: "kes" | "pct" | "count" | "days";
  /** Which auto-populate puller (lib/performanceTracker/autoPopulate.ts)
   *  supplies this metric's `actual`, or null = manual-only — either genuinely
   *  external (Collections/DSO/Attrition/Training are Accounts/HR data, not
   *  in this dashboard) or requiring a judgment call (Weighted Distribution %,
   *  CTT investment figures). */
  autoSource: AutoSourceKey | null;
  /** This metric's share (0-1) of the tracker's overall weighted score, or
   *  null if it's shown for context only and isn't part of the formula. */
  weight: number | null;
  /** Attrition-style metrics where a LOWER actual is better — score
   *  contribution is MAX(0, 1 - actual/target) * weight instead of the usual
   *  actual/target * weight. */
  invert?: boolean;
  /** True when this line is itself a computed ratio (e.g. "GP Margin %
   *  (Actual)") rather than something entered/pulled directly — computed at
   *  render time from sibling metrics, never stored as its own target/actual. */
  computedFrom?: { numerator: string; denominator: string };
}

export interface SectionDefinition {
  key: string;
  label: string;
  metrics: MetricDefinition[];
}

export const HOD_SECTIONS: SectionDefinition[] = [
  {
    key: "revenue_gp",
    label: "1. Revenue & Gross Profit",
    metrics: [
      { key: "revenueTarget", label: "Revenue Target (KES)", unit: "kes", autoSource: null, weight: null },
      { key: "revenueActual", label: "Revenue Actual (KES)", unit: "kes", autoSource: "revenueActual", weight: 0.25 },
      { key: "gpTarget", label: "Gross Profit Target (KES)", unit: "kes", autoSource: null, weight: null },
      { key: "gpActual", label: "Gross Profit Actual (KES)", unit: "kes", autoSource: "gpActual", weight: 0.15 },
      { key: "gpMarginTargetPct", label: "GP Margin % (Target)", unit: "pct", autoSource: null, weight: null },
      { key: "gpMarginActualPct", label: "GP Margin % (Actual)", unit: "pct", autoSource: null, weight: null, computedFrom: { numerator: "gpActual", denominator: "revenueActual" } },
    ],
  },
  {
    key: "distribution",
    label: "2. Distribution",
    metrics: [
      { key: "totalOutletUniverse", label: "Total Outlet Universe", unit: "count", autoSource: "totalOutletUniverse", weight: null },
      { key: "outletsWithDistribution", label: "Outlets with Distribution", unit: "count", autoSource: "outletsWithDistribution", weight: null },
      { key: "numericDistributionPct", label: "Numeric Distribution %", unit: "pct", autoSource: null, weight: 0.15, computedFrom: { numerator: "outletsWithDistribution", denominator: "totalOutletUniverse" } },
      { key: "weightedDistributionPct", label: "Weighted Distribution %", unit: "pct", autoSource: null, weight: 0.05 },
      { key: "newOutletsListed", label: "New Outlets Listed", unit: "count", autoSource: null, weight: null },
    ],
  },
  {
    key: "ctt",
    label: "3. Cost to Trade (CTT)",
    metrics: [
      { key: "customerChannelInvestment", label: "Customer & Channel Investment", unit: "kes", autoSource: null, weight: null },
      { key: "distributionCommercialCosts", label: "Distribution & Commercial Costs", unit: "kes", autoSource: null, weight: null },
      { key: "priceDiscountInvestmentPct", label: "Price & Discount Investment", unit: "pct", autoSource: null, weight: null },
      { key: "distrWholesalerMarginsPct", label: "Distr./Wholesaler Margins", unit: "pct", autoSource: null, weight: null },
      { key: "visibilityExecutionPct", label: "Visibility Execution", unit: "pct", autoSource: null, weight: null },
    ],
  },
  {
    key: "strike_rate",
    label: "4. Strike Rate & Call Activity",
    metrics: [
      { key: "callsPlanned", label: "Calls Planned", unit: "count", autoSource: null, weight: null },
      { key: "callsMade", label: "Calls Made", unit: "count", autoSource: "callsMade", weight: null },
      { key: "productiveCalls", label: "Productive Calls", unit: "count", autoSource: "productiveCalls", weight: null },
      { key: "strikeRatePct", label: "Strike Rate %", unit: "pct", autoSource: null, weight: 0.1, computedFrom: { numerator: "productiveCalls", denominator: "callsMade" } },
      { key: "avgCallsPerRepPerDay", label: "Avg Calls / Rep / Day", unit: "count", autoSource: null, weight: null },
    ],
  },
  {
    key: "collections",
    label: "5. Collections & Credit",
    metrics: [
      { key: "totalInvoiced", label: "Total Invoiced (KES)", unit: "kes", autoSource: null, weight: null },
      { key: "totalCollected", label: "Total Collected (KES)", unit: "kes", autoSource: null, weight: null },
      { key: "collectionEfficiencyPct", label: "Collection Efficiency %", unit: "pct", autoSource: null, weight: 0.1, computedFrom: { numerator: "totalCollected", denominator: "totalInvoiced" } },
      { key: "overdueReceivables", label: "Overdue Receivables (KES)", unit: "kes", autoSource: null, weight: null },
      { key: "dsoDays", label: "DSO (Days)", unit: "days", autoSource: null, weight: null },
    ],
  },
  {
    key: "team_retention",
    label: "6. Team & Retention",
    metrics: [
      { key: "activeSalesReps", label: "Active Sales Reps", unit: "count", autoSource: "activeSalesReps", weight: null },
      { key: "repsAtAboveTarget", label: "Reps at / Above Target", unit: "count", autoSource: null, weight: null },
      { key: "repsBelowTarget", label: "Reps Below Target", unit: "count", autoSource: null, weight: null },
      { key: "voluntaryAttritionPct", label: "Voluntary Attrition %", unit: "pct", autoSource: null, weight: 0.05, invert: true },
      { key: "trainingSessionsHeld", label: "Training Sessions Held", unit: "count", autoSource: null, weight: null },
    ],
  },
];

export const TL_SECTIONS: SectionDefinition[] = [
  {
    key: "volume_revenue",
    label: "1. Volume & Revenue",
    metrics: [
      { key: "volumeTargetCases", label: "Volume Target (Cases)", unit: "count", autoSource: null, weight: null },
      { key: "volumeActualCases", label: "Volume Actual (Cases)", unit: "count", autoSource: null, weight: null },
      { key: "revenueTarget", label: "Revenue Target (KES)", unit: "kes", autoSource: null, weight: null },
      { key: "revenueActual", label: "Revenue Actual (KES)", unit: "kes", autoSource: "revenueActual", weight: null },
    ],
  },
  {
    key: "distribution",
    label: "2. Distribution",
    metrics: [
      { key: "totalOutletsUniverse", label: "Total Outlets Universe", unit: "count", autoSource: "totalOutletUniverse", weight: null },
      { key: "outletsWithDistribution", label: "Outlets with Distribution", unit: "count", autoSource: "outletsWithDistribution", weight: null },
      { key: "numericDistributionPct", label: "Numeric Distribution %", unit: "pct", autoSource: null, weight: null, computedFrom: { numerator: "outletsWithDistribution", denominator: "totalOutletsUniverse" } },
      { key: "weightedDistributionPct", label: "Weighted Distribution %", unit: "pct", autoSource: null, weight: null },
      { key: "newOutletsListed", label: "New Outlets Listed", unit: "count", autoSource: null, weight: null },
    ],
  },
  {
    key: "strike_rate",
    label: "3. Strike Rate / Call Activity",
    metrics: [
      { key: "totalCallsPlanned", label: "Total Calls Planned", unit: "count", autoSource: null, weight: null },
      { key: "totalCallsMade", label: "Total Calls Made", unit: "count", autoSource: "callsMade", weight: null },
      { key: "productiveCalls", label: "Productive Calls", unit: "count", autoSource: "productiveCalls", weight: null },
      { key: "strikeRatePct", label: "Strike Rate %", unit: "pct", autoSource: null, weight: null, computedFrom: { numerator: "productiveCalls", denominator: "totalCallsMade" } },
      { key: "callRatePct", label: "Call Rate %", unit: "pct", autoSource: null, weight: null, computedFrom: { numerator: "totalCallsMade", denominator: "totalCallsPlanned" } },
    ],
  },
  {
    key: "oos",
    label: "4. Out-of-Stock (OOS)",
    metrics: [
      { key: "outletsAudited", label: "Outlets Audited", unit: "count", autoSource: null, weight: null },
      { key: "oosInstancesFound", label: "OOS Instances Found", unit: "count", autoSource: null, weight: null },
      { key: "oosRatePct", label: "OOS Rate %", unit: "pct", autoSource: null, weight: null, computedFrom: { numerator: "oosInstancesFound", denominator: "outletsAudited" } },
      { key: "perfectStoreCount", label: "Perfect Store Count", unit: "count", autoSource: null, weight: null },
    ],
  },
  {
    key: "team_pipeline",
    label: "5. Team & Pipeline",
    metrics: [
      { key: "activeSalesReps", label: "Active Sales Reps", unit: "count", autoSource: "activeSalesReps", weight: null },
      { key: "repsAtAboveTarget", label: "Reps at / Above Target", unit: "count", autoSource: null, weight: null },
      { key: "newSkusListed", label: "New SKUs Listed", unit: "count", autoSource: null, weight: null },
      { key: "customerReturnsClaims", label: "Customer Returns / Claims", unit: "count", autoSource: null, weight: null },
    ],
  },
];

export function sectionsFor(type: "HOD" | "TEAM_LEADER"): SectionDefinition[] {
  return type === "HOD" ? HOD_SECTIONS : TL_SECTIONS;
}

export function allMetricsFor(type: "HOD" | "TEAM_LEADER"): MetricDefinition[] {
  return sectionsFor(type).flatMap((s) => s.metrics);
}

export function metricDefinition(type: "HOD" | "TEAM_LEADER", key: string): MetricDefinition | undefined {
  return allMetricsFor(type).find((m) => m.key === key);
}
