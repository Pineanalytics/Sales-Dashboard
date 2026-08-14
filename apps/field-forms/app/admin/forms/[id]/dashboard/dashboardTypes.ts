export interface Kpis {
  totalVisits: number;
  avgSos: number | null;
  oosRatePct: number;
  avgPos: number | null;
  deliveryRatePct: number;
  competitorRatePct: number;
  retailers: number;
  branches: number;
  regions: number;
  dateRangeLabel: string;
}

export interface SummaryRow {
  name: string;
  visits: number;
  avgSos: number | null;
  avgShelfOcc: number | null;
  oos: number;
  oosRatePct: number;
  avgPos: number | null;
  deliveryRatePct: number;
  linkHref?: string;
}

export interface VisitRow {
  id: string;
  date: string;
  time: string;
  merchandiser: string;
  retailer: string;
  region: string;
  branch: string;
  sosPct: number | null;
  oos: string;
  competitor: string;
  skuCount: number;
  shelfOccPct: number | null;
  positioning: string;
  poStatus: string;
  delivery: string;
}

export interface OosLogRow {
  id: string;
  date: string;
  merchandiser: string;
  retailer: string;
  branch: string;
  region: string;
  itemsReported: string;
}

export interface DashboardData {
  kpis: Kpis;
  dailyVisits: { date: string; count: number }[];
  posDist: { label: string; count: number }[];
  poDist: { label: string; count: number }[];
  deliveryDist: { label: string; count: number }[];
  merch: SummaryRow[];
  retailer: SummaryRow[];
  region: SummaryRow[];
  oosLog: OosLogRow[];
  rawRows: VisitRow[];
  photos: {
    submissionId: string;
    url: string;
    outlet: string;
    retailer: string;
    submittedAt: string;
  }[];
  formId: string;
}
