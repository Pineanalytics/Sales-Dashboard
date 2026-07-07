import * as XLSX from "xlsx";

const MONTHLY_SALES_HEADER = [
  "Year", "Month Name", "Location", "Principal",
  "Revenue.", "Monthly Target", "Cost Of Goods.", "Gross Profit.", "Gross Margin %",
];

// Mirrors the real export: targets only exist from 2026 onward, so every 2025 row
// has a blank Monthly Target cell (must parse to null, never 0). Two principals
// ("EABL-Nyeri"/"EABL-Nyahururu") share a normalized brand key, and a trailing
// "Grand Total" row must be excluded, matching the real pivot export's own totals.
const monthlySalesRows: unknown[][] = [
  ["MONTHLY SALES VS TARGET"],
  MONTHLY_SALES_HEADER,
  ["2025", "May", "Nyeri", "EABL-Nyeri", 100000, null, 88000, 12000, 0.12],
  ["2025", "May", "Nyahururu", "EABL-Nyahururu", 80000, null, 70000, 10000, 0.125],
  ["2025", "May", "Nairobi", "Upfield-Nairobi", 60000, null, 54000, 6000, 0.1],
  ["2025", "May", "", "Total", 240000, null, 212000, 28000, 0.1167],
  ["2026", "June", "Nyeri", "EABL-Nyeri", 110000, 120000, 95000, 15000, 0.1364],
  ["2026", "June", "Nyahururu", "EABL-Nyahururu", 90000, 95000, 78000, 12000, 0.1333],
  ["2026", "June", "Nairobi", "Upfield-Nairobi", 70000, 65000, 60000, 10000, 0.1429],
  ["2026", "June", "", "Grand Total", 270000, 280000, 233000, 37000, 0.137],
];

// No Year column (matches the real sheet) — parseWorkbook() backfills year from
// monthlySales' max year (2026). Multiple reps per principal exercise the rep
// drill-down; a row with Employee Name "Total" must be skipped.
const monthlyCoverageRows: unknown[][] = [
  ["EFFECTIVE COVERAGE MONTHLY"],
  ["Month Name", "SalesRole", "Employee Name", "Principal", "Coverage.", "Productive Calls", "Productivity %"],
  ["May", "Primary Sales", "Jane Doe", "EABL-Nyeri", 120, 100, 0.8333],
  ["May", "Primary Sales", "John Smith", "EABL-Nyahururu", 90, 70, 0.7778],
  ["May", "Primary Sales", "Jane Doe", "Upfield-Nairobi", 60, 50, 0.8333],
  ["June", "Primary Sales", "Jane Doe", "EABL-Nyeri", 130, 115, 0.8846],
  ["June", "Primary Sales", "John Smith", "EABL-Nyahururu", 95, 80, 0.8421],
  ["June", "Primary Sales", "Jane Doe", "Upfield-Nairobi", 65, 58, 0.8923],
  ["June", "Primary Sales", "Total", "", 290, 253, 0.8724],
];

// Two transaction-line rows share the same Year+Month+Principal+Rep+Customer
// (Cash Customer / Jane Doe / EABL-Nyeri, June 2026) but different Item Name —
// the parser must collapse these into one row, summing Volume/Revenue/GP and
// deriving GP Margin % from the summed totals (never from a per-line percentage,
// and never left at the source pivot's grain — see parseMonthlyBrandCustomer).
const brandCustomerRows: unknown[][] = [
  ["MONTHLY CUSTOMER,BRAND & REP PERFORMANCE"],
  ["Year", "Month Name", "Principal", "Sales Employee", "Customer Name", "Item Name", "Volume", "Revenue", "GP", "GP Margin %"],
  ["2026", "June", "EABL-Nyeri", "Jane Doe", "Cash Customer", "EABL Lager 500ml", 60, 30000, 4800, 0.16],
  ["2026", "June", "EABL-Nyeri", "Jane Doe", "Cash Customer", "EABL Stout 330ml", 40, 20000, 3200, 0.16],
  ["2026", "June", "EABL-Nyahururu", "John Smith", "Golden Marketing", "", 60, 30000, 4500, 0.15],
  ["2026", "June", "Upfield-Nairobi", "Jane Doe", "Cash Customer", "", 40, 20000, 2000, 0.1],
];

// Matches the same rows without the optional Item Name/GP Margin % columns —
// confirms neither column is required for the sheet to parse.
const brandCustomerRowsNoOptionalCols: unknown[][] = [
  ["MONTHLY CUSTOMER,BRAND & REP PERFORMANCE"],
  ["Year", "Month Name", "Principal", "Sales Employee", "Customer Name", "Volume", "Revenue", "GP"],
  ["2026", "June", "EABL-Nyeri", "Jane Doe", "Cash Customer", 100, 50000, 8000],
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
    ["All Month Sales Vs Target", monthlySalesRows],
    ["Calls & Productivity", monthlyCoverageRows],
    ["Brand&Customer Listing", brandCustomerRows],
    ["Stock Balances", stockRows],
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

export { monthlySalesRows, brandCustomerRowsNoOptionalCols };
