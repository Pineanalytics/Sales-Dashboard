// Upload examples: for each admin upload form, the file format it expects (columns, which are required, notes) and a small example built from the
// data already in the dashboard, in exactly the shape the upload reads back. The formats are written to match each parser (lib/parseProducts.ts,
// lib/parseTargets.ts, lib/rosterImport.ts, lib/salesLeadershipImport.ts, lib/upfieldOutletMaster.ts). The builders are pure; the loaders that read
// the database live in lib/uploadExamplesServer.ts.
import * as XLSX from "xlsx";

export type UploadKind = "products" | "targets" | "roster" | "sales-leadership" | "upfield-outlets";

export const UPLOAD_KINDS: UploadKind[] = ["products", "targets", "roster", "sales-leadership", "upfield-outlets"];

export function isUploadKind(value: string): value is UploadKind {
  return (UPLOAD_KINDS as string[]).includes(value);
}

export type ExampleCell = string | number | Date;

export interface ExampleTable {
  columns: string[];
  rows: ExampleCell[][];
}

export interface UploadColumn {
  name: string;
  required: boolean;
  meaning: string;
}

export interface UploadFormat {
  kind: UploadKind;
  /** The file type the example downloads as (and the form accepts). */
  fileType: "csv" | "xlsx";
  /** The form's accepted files, in words. */
  accepts: string;
  filename: string;
  sheetName?: string;
  notes: string[];
  columns: UploadColumn[];
}

export const UPLOAD_FORMATS: Record<UploadKind, UploadFormat> = {
  products: {
    kind: "products",
    fileType: "csv",
    accepts: "CSV or Excel (.csv, .xlsx, .xls, .xlsm)",
    filename: "product-master-example.csv",
    sheetName: "Products",
    notes: [
      "One row per SAP item. An Item No. already on file is updated in place; new items are added; nothing is deleted.",
      "Headers are matched ignoring case, spaces and punctuation (\"Item No.\", \"Item Number\", \"Product Code\" and \"SAP Code\" all work). In a workbook, use a sheet named Products, or the first sheet; the header row can be within the first 10 rows.",
      "Principal is the base name only (Highchem, not Highchem-Nairobi): sales are mapped to <Principal>-<warehouse location>, which must already be an Active principal.",
      "Leave a cell empty when there is no value. Numbers may carry thousands commas.",
    ],
    columns: [
      { name: "Item No.", required: true, meaning: "The SAP item code." },
      { name: "Item Description", required: false, meaning: "The item's description." },
      { name: "Series", required: false, meaning: "A series code (for example 222; 0 when there is none)." },
      { name: "Size", required: false, meaning: "The pack as text (for example 48-Pack)." },
      { name: "Pack Size", required: false, meaning: "Units in the pack, as a number (48)." },
      { name: "Principal", required: true, meaning: "The principal the item belongs to (base name)." },
      { name: "Cost Price", required: false, meaning: "The cost price, as a number." },
      { name: "Classification", required: false, meaning: "The classification (for example General)." },
      { name: "SSU Conversion", required: false, meaning: "The SSU conversion factor, as a number (usually 1)." },
    ],
  },
  targets: {
    kind: "targets",
    fileType: "xlsx",
    accepts: "Excel (.xlsx, .xls, .xlsm)",
    filename: "targets-example.xlsx",
    sheetName: "Targets Per Principal",
    notes: [
      "One row per principal per month. A principal and month already on file is updated with the values in the row.",
      "Use a sheet named \"Targets Per Principal\", or the first sheet; the header row can be within the first 10 rows. Rows whose Principal contains \"total\" are skipped.",
      "The year and month come from Period: put any date in the month, usually the first (2026-11-01). Header names must match exactly, including the leading \"* \".",
      "Leave a target cell empty when the month has none.",
    ],
    columns: [
      { name: "Period", required: true, meaning: "A date in the target month (the first of the month), formatted as a date." },
      { name: "Principal", required: true, meaning: "The full principal name, <Brand>-<Location> (for example Mars-Nairobi)." },
      { name: "Main Principal", required: false, meaning: "The brand without the location." },
      { name: "* Value Target", required: false, meaning: "The month's value target in KES." },
      { name: "* Volume Target", required: false, meaning: "The month's volume target." },
      { name: "* Coverage Target", required: false, meaning: "The month's coverage target (outlets)." },
      { name: "* Productivity Target", required: false, meaning: "The month's productive-calls target." },
    ],
  },
  roster: {
    kind: "roster",
    fileType: "csv",
    accepts: "CSV (.csv), one header row",
    filename: "roster-example.csv",
    notes: [
      "One row per rep per principal. Every row is added or updated; nothing is deactivated automatically.",
      "\"Download current roster (CSV)\" gives every current assignment in this same 18-column shape: edit it and upload it back for bulk changes.",
      "Contribution % is written as a percentage (25.00%). Sales Role is Primary or Secondary. The older 21-column workbook export (with Active (Y/N) and similar) is also accepted.",
      "Team Leader, Sales Supervisor and Manager are matched by name to the people already on file.",
    ],
    columns: [
      { name: "Employee Code", required: true, meaning: "The rep's employee code." },
      { name: "Employee (Sales Edge Name)", required: true, meaning: "The rep's name as SalesEdge (Pine) shows it." },
      { name: "SAP Name", required: false, meaning: "The rep's name as SAP shows it; this is what links SAP sales to the rep." },
      { name: "Channel", required: false, meaning: "Free text, for example GT or KA." },
      { name: "Team Leader", required: true, meaning: "The Team Leader the rep reports to." },
      { name: "Principal", required: true, meaning: "The principal the row is for, <Brand>-<Location>." },
      { name: "* Contribution %", required: false, meaning: "The rep's share of the principal's target." },
      { name: "Sales Role", required: true, meaning: "Primary or Secondary." },
      { name: "Absolute Principal", required: false, meaning: "The rep's single home principal." },
      { name: "Work Group", required: false, meaning: "The rep's work group (for example TDR)." },
      { name: "Region", required: false, meaning: "Region." },
      { name: "Sub Region", required: false, meaning: "Sub-region." },
      { name: "Cost Center", required: false, meaning: "Cost centre." },
      { name: "Sales Point", required: false, meaning: "Sales point." },
      { name: "Route", required: false, meaning: "Route." },
      { name: "Stock Point", required: false, meaning: "Stock point." },
      { name: "Sales Supervisor", required: false, meaning: "The Sales Supervisor above the Team Leader." },
      { name: "Manager", required: false, meaning: "The Manager above the Supervisor." },
    ],
  },
  "sales-leadership": {
    kind: "sales-leadership",
    fileType: "csv",
    accepts: "CSV (.csv), one header row",
    filename: "sales-leadership-example.csv",
    notes: [
      "One row per Principal and Team Leader. It creates any Head of Sales, Supervisor or Team Leader not yet on file and links them: Team Leader to Supervisor, Supervisor directly to Head of Sales.",
      "A Principal that appears under one Team Leader gives that Team Leader dashboard access to it; a Principal shared by several Team Leaders is left unchanged at rep level.",
      "The emails link each person to their login; they are lowercased and may be left empty. The Head Of Sales Email column is accepted but not used yet.",
      "A Supervisor who is their own Team Leader appears with the same name in both columns (for example Emmy and Emmy).",
    ],
    columns: [
      { name: "Principal", required: true, meaning: "The principal, <Brand>-<Location>. Created if it does not exist yet." },
      { name: "Sales Supervisor", required: true, meaning: "The Sales Supervisor over the Team Leader." },
      { name: "Sales Supervisor Email", required: false, meaning: "The Supervisor's login email." },
      { name: "Team Leader", required: true, meaning: "The Team Leader for the principal." },
      { name: "Team Leader Email", required: false, meaning: "The Team Leader's login email." },
      { name: "Head Of Sales", required: true, meaning: "The Head of Sales the Supervisor reports to." },
      { name: "Head Of Sales Email", required: false, meaning: "Accepted, not used yet." },
    ],
  },
  "upfield-outlets": {
    kind: "upfield-outlets",
    fileType: "xlsx",
    accepts: "Excel (.xlsx, .xls): the DataEdge export OutletsList_KDwise_<date>.xlsx",
    filename: "upfield-outlet-list-example.xlsx",
    sheetName: "OutletsList",
    notes: [
      "One row per outlet. The upload replaces the whole list: outlets missing from the new file are removed.",
      "The first sheet is read. A banner row above the headers (From: ... To: ...) is fine: the header row is found within the first 15 rows by Outlet_Code and Outlet_Name.",
      "Headers are matched ignoring case, spaces and underscores. Outlet_Code is the DataEdge customer code, which is how outlets are matched to sales.",
      "Route_FSR is the rep's name with the login in brackets (Name (login)). GeoPoint is \"latitude,longitude\"; a point outside Kenya is ignored. Route_Day is lowercased on upload.",
    ],
    columns: [
      { name: "Outlet_Code", required: true, meaning: "The DataEdge customer code." },
      { name: "Outlet_Name", required: true, meaning: "The outlet's name." },
      { name: "Company", required: false, meaning: "The company the outlet belongs to." },
      { name: "Contact_Name", required: false, meaning: "The outlet's contact person." },
      { name: "Phone", required: false, meaning: "The contact's phone number." },
      { name: "Type", required: false, meaning: "Outlet type (Shop, Kiosk, Wholesaler, Supermarket...)." },
      { name: "Channel", required: false, meaning: "Channel (retail, wholesale...)." },
      { name: "Territory", required: false, meaning: "Territory." },
      { name: "Route_FSR", required: false, meaning: "The route's FSR: Name (login)." },
      { name: "Location", required: false, meaning: "Location text." },
      { name: "GeoPoint", required: false, meaning: "Latitude,longitude." },
      { name: "Route_Day", required: false, meaning: "The day of the week the route is served." },
      { name: "Route_Week", required: false, meaning: "The week of the cycle the route is served." },
    ],
  },
};

// --- sampling -------------------------------------------------------------------------------------------------------------------------------

/** Up to `perGroup` items from each of the `maxGroups` biggest groups, in the order given (so the caller sorts first for a stable pick). */
export function sampleByGroup<T>(items: T[], groupOf: (item: T) => string, perGroup: number, maxGroups: number): T[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = groupOf(item);
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  const biggest = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1)).slice(0, maxGroups);
  return biggest.flatMap(([, list]) => list.slice(0, perGroup));
}

const filled = (values: unknown[]) => values.filter((value) => value !== null && value !== undefined && value !== "").length;

// --- builders -------------------------------------------------------------------------------------------------------------------------------

export interface ProductInput {
  itemNo: string;
  itemDescription: string | null;
  series: string | null;
  size: string | null;
  packSize: number | null;
  principal: string;
  costPrice: number | null;
  classification: string | null;
  ssuConversion: number | null;
}

/** Two of the best-filled products from each of the six biggest principals, so the example shows every column with a real value. */
export function productsExample(products: ProductInput[]): ExampleTable {
  const rank = (p: ProductInput) => filled([p.itemDescription, p.series, p.size, p.packSize, p.costPrice, p.classification, p.ssuConversion]);
  const ordered = [...products].filter((p) => p.principal.trim() !== "").sort((a, b) => rank(b) - rank(a) || (a.itemNo < b.itemNo ? -1 : 1));
  const picked = sampleByGroup(ordered, (p) => p.principal, 2, 6).sort((a, b) => (a.itemNo < b.itemNo ? -1 : 1));
  return {
    columns: UPLOAD_FORMATS.products.columns.map((column) => column.name),
    rows: picked.map((p) => [p.itemNo, p.itemDescription ?? "", p.series ?? "", p.size ?? "", p.packSize ?? "", p.principal, p.costPrice ?? "", p.classification ?? "", p.ssuConversion ?? ""]),
  };
}

export interface TargetInput {
  year: string;
  monthIndex: number;
  principal: string;
  mainPrincipal: string | null;
  valueTarget: number | null;
  volumeTarget: number | null;
  coverageTarget: number | null;
  productivityTarget: number | null;
}

/** The most recent month that has at least three targets: its first 10 principals, with Period as the first of the month (a real date cell in the workbook). */
export function targetsExample(targets: TargetInput[]): ExampleTable {
  const counts = new Map<string, number>();
  for (const t of targets) counts.set(`${t.year}|${t.monthIndex}`, (counts.get(`${t.year}|${t.monthIndex}`) ?? 0) + 1);
  const months = [...counts.entries()]
    .filter(([, n]) => n >= 3)
    .map(([key]) => key.split("|"))
    .sort((a, b) => Number(b[0]) - Number(a[0]) || Number(b[1]) - Number(a[1]));
  const columns = UPLOAD_FORMATS.targets.columns.map((column) => column.name);
  if (months.length === 0) return { columns, rows: [] };
  const [year, monthIndex] = months[0];
  const period = new Date(Date.UTC(Number(year), Number(monthIndex), 1));
  const rows = targets
    .filter((t) => t.year === year && t.monthIndex === Number(monthIndex))
    .sort((a, b) => (a.principal < b.principal ? -1 : 1))
    .slice(0, 10)
    .map((t) => [period, t.principal, t.mainPrincipal ?? "", t.valueTarget ?? "", t.volumeTarget ?? "", t.coverageTarget ?? "", t.productivityTarget ?? ""] as ExampleCell[]);
  return { columns, rows };
}

export interface LeadershipInput {
  principal: string;
  supervisor: string;
  supervisorEmail: string | null;
  teamLeader: string;
  teamLeaderEmail: string | null;
  headOfSales: string;
}

/** The org chart as it stands, one row per principal and Team Leader, ordered Head of Sales, Supervisor, principal; at most 15 rows. */
export function leadershipExample(rows: LeadershipInput[]): ExampleTable {
  const ordered = [...rows].sort((a, b) => a.headOfSales.localeCompare(b.headOfSales) || a.supervisor.localeCompare(b.supervisor) || a.principal.localeCompare(b.principal) || a.teamLeader.localeCompare(b.teamLeader));
  return {
    columns: UPLOAD_FORMATS["sales-leadership"].columns.map((column) => column.name),
    rows: ordered.slice(0, 15).map((r) => [r.principal, r.supervisor, r.supervisorEmail ?? "", r.teamLeader, r.teamLeaderEmail ?? "", r.headOfSales, ""]),
  };
}

export interface UpfieldOutletInput {
  outletCode: string;
  outletName: string;
  company: string | null;
  contactName: string | null;
  phone: string | null;
  outletType: string | null;
  channel: string | null;
  territory: string | null;
  fsrName: string | null;
  fsrLogin: string | null;
  location: string | null;
  latitude: number | null;
  longitude: number | null;
  routeDay: string | null;
  routeWeek: string | null;
}

/** Twelve outlets, taken in turn from each channel (the best-filled first), so the example shows the channels, types and routes really in use. */
export function upfieldOutletsExample(outlets: UpfieldOutletInput[]): ExampleTable {
  const rank = (o: UpfieldOutletInput) => filled([o.company, o.contactName, o.outletType, o.channel, o.territory, o.fsrName, o.location, o.latitude, o.routeDay, o.routeWeek]);
  const ordered = [...outlets].sort((a, b) => rank(b) - rank(a) || (a.outletCode < b.outletCode ? -1 : 1));
  const byChannel = new Map<string, UpfieldOutletInput[]>();
  for (const outlet of ordered) {
    const key = outlet.channel ?? "";
    const list = byChannel.get(key) ?? [];
    list.push(outlet);
    byChannel.set(key, list);
  }
  const lists = [...byChannel.values()];
  const picked: UpfieldOutletInput[] = [];
  for (let round = 0; picked.length < 12 && lists.some((list) => list.length > round); round++) {
    for (const list of lists) if (list[round] && picked.length < 12) picked.push(list[round]);
  }
  return {
    columns: UPLOAD_FORMATS["upfield-outlets"].columns.map((column) => column.name),
    rows: picked.map((o) => [
      o.outletCode,
      o.outletName,
      o.company ?? "",
      o.contactName ?? "",
      o.phone ?? "",
      o.outletType ?? "",
      o.channel ?? "",
      o.territory ?? "",
      o.fsrName ? (o.fsrLogin ? `${o.fsrName} (${o.fsrLogin})` : o.fsrName) : "",
      o.location ?? "",
      o.latitude !== null && o.longitude !== null ? `${o.latitude},${o.longitude}` : "",
      o.routeDay ?? "",
      o.routeWeek ?? "",
    ]),
  };
}

// --- files ----------------------------------------------------------------------------------------------------------------------------------

const ymd = (d: Date) => d.toISOString().slice(0, 10);

function csvEscape(value: ExampleCell): string {
  const text = value instanceof Date ? ymd(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The table as CSV (CRLF lines, quoted where needed), like the existing roster and Product Master downloads. */
export function exampleToCsv(table: ExampleTable): string {
  return [table.columns.map(csvEscape).join(","), ...table.rows.map((row) => row.map(csvEscape).join(","))].join("\r\n");
}

/** The table as a one-sheet workbook. `banner` rows go above the header row (the Upfield export starts with one); dates are real date cells. */
export function exampleToXlsx(table: ExampleTable, options: { sheetName: string; banner?: string[] }): Buffer {
  const banner = (options.banner ?? []).map((line) => [line]);
  const sheet = XLSX.utils.aoa_to_sheet([...banner, table.columns, ...table.rows], { cellDates: true, dateNF: "yyyy-mm-dd" });
  sheet["!cols"] = table.columns.map((header, col) => {
    let longest = header.length;
    for (const row of table.rows.slice(0, 50)) longest = Math.max(longest, row[col] instanceof Date ? 10 : String(row[col] ?? "").length);
    return { wch: Math.min(48, Math.max(10, longest + 2)) };
  });
  const headerRow = banner.length;
  table.rows.forEach((row, index) => {
    row.forEach((value, col) => {
      if (!(value instanceof Date)) return;
      const cell = sheet[XLSX.utils.encode_cell({ r: headerRow + 1 + index, c: col })];
      if (cell) cell.z = "yyyy-mm-dd";
    });
  });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, options.sheetName.slice(0, 31));
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

/** A column's example for the format guide: its first non-empty value in the example rows, or "" when none has one. */
export function exampleValue(table: ExampleTable | null, column: string): string {
  if (!table) return "";
  const index = table.columns.indexOf(column);
  if (index < 0) return "";
  for (const row of table.rows) {
    const value = row[index];
    if (value === null || value === undefined || value === "") continue;
    return value instanceof Date ? ymd(value) : String(value);
  }
  return "";
}
