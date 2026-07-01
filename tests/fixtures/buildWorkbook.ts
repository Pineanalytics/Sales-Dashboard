import * as XLSX from "xlsx";

const SALES_HEADER = [
  "Principal",
  "Current Month Target",
  "MTD Target",
  "MTD Revenue",
  "Achieved Vs Full Target",
  "Achieved Vs MTD Target",
  "Balance Of Month",
  "Revenue LMSP",
  "MOM",
  "Revenue LYSP",
  "YOY",
  "YTD Revenue.",
  "Full Year Target",
  "YTD Variance",
  "YTD Vs Target",
  "H1 Sales.",
  "H1 Mission",
  "H1 Variance",
  "Average Sales",
  "Gross Profit.",
  "Gross Margin %",
  "Next Month Forecast",
  "Next Quarter Forecast",
];

const salesVsTargetRows: unknown[][] = [
  ["JUNE 2026 MTD SALES VS TARGET & YTD ACTUALS"],
  SALES_HEADER,
  ["EABL-Nyeri", 100000, 50000, 45000, 0.45, 0.9, -5000, 40000, 0.125, 35000, 0.2857, 300000, 1200000, -20000, 0.9375, 250000, 260000, -10000, 42000, 54000, 0.12, 48000, 140000],
  ["EABL-Nyahururu", 80000, 40000, 42000, 0.525, 1.05, 2000, 38000, 0.105, 30000, 0.4, 260000, 960000, 5000, 1.02, 230000, 225000, 5000, 39000, 46800, 0.18, 44000, 132000],
  ["Upfield-Nairobi", 60000, 30000, 10000, 0.17, 0.33, -20000, 15000, -0.33, 9000, 0.11, 90000, 720000, -30000, 0.75, 70000, 100000, -30000, 15000, 9000, 0.1, 12000, 36000],
  ["Weetabix-Meru", 20000, 0, 5000, 0.25, null, 5000, 4000, 0.25, 3000, 0.667, 40000, 240000, -2000, 0.95, 35000, 40000, -5000, 6000, 4000, 0.1, 6000, 18000],
  ["Total Sales", 260000, 120000, 102000, 0.35, 0.85, -18000, 97000, 0.052, 77000, 0.32, 690000, 3120000, -47000, 0.9, 585000, 625000, -40000, 102000, 113800, 0.117, 110000, 326000],
];

const coverageRows: unknown[][] = [
  ["COVERAGE REPORT"],
  ["Month Name", "Principal", "Coverage.", "Productive Calls", "Productivity %"],
  ["May", "EABL-Nyeri", 120, 100, 0.8333],
  ["May", "EABL-Nyahururu", 90, 70, 0.7778],
  ["May", "Upfield-Nairobi", 60, 50, 0.8333],
  ["May Total", "", 270, 220, 0.8148],
  ["June", "EABL-Nyeri", 130, 115, 0.8846],
  ["June", "EABL-Nyahururu", 95, 80, 0.8421],
  ["June", "Upfield-Nairobi", 65, 58, 0.8923],
  ["June Total", "", 290, 253, 0.8724],
  ["Average", "", 280, 236.5, 0.8436],
];

const stockRows: unknown[][] = [
  ["Principal", "Item Description", "Opening Volume", "Opening Stock Pcs", "Opening Value", "RR/Week-Value", "RR/Week-Volume", "Days Cover", "Action!"],
  ["EABL-Nyeri", "EABL Lager 500ml", 10, 100, 1000, 2000, 20, 0, ""],
  ["EABL-Nyeri", "EABL Stout 330ml", 50, 500, 5000, 1000, 10, 0, ""],
  ["EABL-Nyahururu", "EABL Malt 500ml", 10, 100, 1000, 1000, 10, 0, ""],
  ["Upfield-Nairobi", "Upfield Margarine 500g", 0, 0, 0, 500, 5, 0, ""],
  ["Weetabix-Meru", "Weetabix Original 500g", 8, 800, 900, null, null, null, ""],
  ["Total Balances", "", 70, 700, 7000, 4500, 45, 0, ""],
];

const MONTH_HEADER = ["", "", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const trendedRevenueRows: unknown[][] = [
  MONTH_HEADER,
  ["2025", "Revenue.", 100000, 110000, 105000, 115000, 120000, 118000, 125000, 130000, 128000, 135000, 140000, 150000],
  ["2026", "Revenue.", 120000, 125000, 130000, 135000, 140000, 145000, null, null, null, null, null, null],
  ["", "YOY", 0.2, 0.136, 0.238, 0.174, 0.167, 0.229, null, null, null, null, null, null],
  ["2025", "Total", 100000, 110000, 105000, 115000, 120000, 118000, 125000, 130000, 128000, 135000, 140000, 150000],
  [""],
  MONTH_HEADER,
  ["2025", "EABL", 60000, 65000, 62000, 68000, 70000, 69000, 72000, 75000, 74000, 78000, 80000, 85000],
  ["2026", "EABL", 72000, 75000, 78000, 80000, 82000, 85000, null, null, null, null, null, null],
  ["2025", "Upfield", 40000, 45000, 43000, 47000, 50000, 49000, 53000, 55000, 54000, 57000, 60000, 65000],
  ["2026", "Upfield", 48000, 50000, 52000, 55000, 58000, 60000, null, null, null, null, null, null],
  ["2026", "Total", 120000, 125000, 130000, 135000, 140000, 145000, null, null, null, null, null, null],
];

const weeklyProjectionRows: unknown[][] = [
  ["WEEKLY PROJECTION"],
  ["Principal", "Weekly Revenue", "Weekly Projection", "Weekly RR", "Week Variance", "Achieved Projection"],
  ["EABL-Nyeri", 12000, 10000, 11000, 2000, 1.2],
  ["EABL-Nyahururu", 9000, 10000, 9500, -1000, null],
  ["Upfield-Nairobi", 3000, 5000, 4000, -2000, 0.6],
  ["Total", 24000, 25000, 24500, -1000, 0.96],
];

export interface FixtureOptions {
  omitSheet?: string;
  /** Replaces a sheet's rows entirely — used to test layout variance (e.g. extra blank rows). */
  sheetOverrides?: Record<string, unknown[][]>;
}

export function buildFixtureWorkbook(options: FixtureOptions = {}): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  const sheets: [string, unknown[][]][] = [
    ["Sales Vs Target", salesVsTargetRows],
    ["Coverage & Productivity", coverageRows],
    ["Stock Balances", stockRows],
    ["Trended Revenue", trendedRevenueRows],
    ["Weekly Projection", weeklyProjectionRows],
    ["Raw Data", [["unused"]]],
  ];
  for (const [name, defaultRows] of sheets) {
    if (options.omitSheet === name) continue;
    const rows = options.sheetOverrides?.[name] ?? defaultRows;
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return out;
}

export { salesVsTargetRows };
