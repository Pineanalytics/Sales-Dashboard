// SAP sales at invoice-line level, following the desktop "SAP B1 Detailed Sales Extraction" tool: how the SFA customer
// name is read, the raw data columns, and the cases and gross profit worked out per line. Pure, no I/O.
//
// SFA customer name: the SAP field U_CustomerName with a trailing bracket moved to "SFA Contact". Where that leaves nothing,
// the SAP customer name (CardName) is filled in and "Customer Ref Remarks" says "Prefilled" instead of "Original".

export type SalesLineDocType = "INVOICE" | "CREDIT_NOTE";

/** A line as it travels from SAP and is stored (SalesLine). Quantities and amounts are signed: credit notes negative. */
export interface SalesLineRecord {
  docType: SalesLineDocType;
  docEntry: number;
  lineNum: number;
  docNum: string;
  docDate: string; // YYYY-MM-DD (SAP TaxDate)
  docStatus: string;
  printed: boolean;
  seriesName: string | null;
  cardCode: string;
  customerName: string;
  sfaName: string | null;
  phone: string | null;
  numAtCard: string | null;
  remarks: string | null;
  salesEmployee: string;
  principal: string;
  itemCode: string;
  itemName: string;
  quantity: number;
  inventoryQty: number;
  packSize: number | null;
  whsCode: string | null;
  whsName: string | null;
  priceBeforeDiscount: number | null;
  price: number | null;
  discountPct: number | null;
  vatAmount: number;
  salesAmount: number;
  paidAmount: number;
  unitCost: number | null;
  createdBy: string | null;
  creationDate: string | null; // YYYY-MM-DD
  costCentre1: string | null;
  costCentre2: string | null;
  costCentre3: string | null;
}

export type CustomerRefRemarks = "Original" | "Prefilled";

export interface SfaCustomerSplit {
  sfaCustomer: string;
  sfaContact: string;
  remarks: CustomerRefRemarks;
}

const TRAILING_BRACKET = /\(([^()]*)\)\s*$/;
/** A unit price below this is a free or promotional line: no gross sales and no cost. */
const FREE_PRICE_THRESHOLD = 0.01;

export function splitSfaCustomer(sfaName: string | null, customerName: string): SfaCustomerSplit {
  let name = (sfaName ?? "").trim();
  let contact = "";
  const match = TRAILING_BRACKET.exec(name);
  if (match) {
    contact = match[1].trim();
    name = name.replace(TRAILING_BRACKET, "").trim();
  }
  return name ? { sfaCustomer: name, sfaContact: contact, remarks: "Original" } : { sfaCustomer: customerName, sfaContact: contact, remarks: "Prefilled" };
}

/** Two lines are the same customer when their SFA customer names match ignoring case and repeated spaces. */
export function lineCustomerKey(sfaCustomer: string): string {
  return sfaCustomer.toUpperCase().split(/\s+/).filter(Boolean).join(" ") || "UNKNOWN";
}

const round = (value: number, places: number) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

export interface SalesLineMeasures {
  cases: number | null;
  grossSales: number;
  cogs: number | null;
  grossProfit: number | null;
}

/** Cases = quantity / pack size. Gross sales = quantity x price before discount; COGs = inventory quantity x purchase price
 *  excluding VAT; both are zero on a free line. Gross profit is blank where the item has no purchase price. */
export function lineMeasures(line: Pick<SalesLineRecord, "quantity" | "inventoryQty" | "packSize" | "priceBeforeDiscount" | "unitCost">): SalesLineMeasures {
  const cases = line.packSize && line.packSize > 0 ? round(line.quantity / line.packSize, 4) : null;
  const free = line.priceBeforeDiscount === null || Math.abs(line.priceBeforeDiscount) < FREE_PRICE_THRESHOLD;
  const grossSales = free ? 0 : line.quantity * (line.priceBeforeDiscount as number);
  const cogs = free ? 0 : line.unitCost === null ? null : line.inventoryQty * line.unitCost;
  return { cases, grossSales, cogs, grossProfit: cogs === null ? null : grossSales - cogs };
}

export const RAW_LINE_COLUMNS = [
  "Doc Type", "CANCELED", "Invoice/Credit Note No", "DocEntry", "DocStatus", "Print Status", "Series", "Doc Date",
  "Customer Code", "Customer Name", "SFA Customer Name", "SFA Contact", "Customer Ref Remarks", "Customer Phone Number",
  "Reference No", "Remarks", "Sales Employee", "Principal", "Item Code", "Item Name", "Qty", "Pack Size", "Cases",
  "Warehouse Code", "Warehouse Name", "Price Before Discount", "Price After Discount", "Discount %", "VAT Amount",
  "Sales Amount", "Paid Amount", "Gross Sales", "Unit Cost", "COGs", "Gross Profit", "Created By", "Creation Date",
  "Cost Centre Dimension 1", "Cost Centre Dimension 2", "Cost Centre Dimension 3",
];

const numberCell = (value: number | null, places = 4): string | number => (value === null ? "" : round(value, places));

/** One line in the order of RAW_LINE_COLUMNS. */
export function rawLineRow(line: SalesLineRecord): (string | number)[] {
  const customer = splitSfaCustomer(line.sfaName, line.customerName);
  const measures = lineMeasures(line);
  return [
    line.docType === "INVOICE" ? "Invoice" : "Credit Note", "N", Number(line.docNum), line.docEntry, line.docStatus, line.printed ? "Printed" : "Not Printed", line.seriesName ?? "", line.docDate,
    line.cardCode, line.customerName, customer.sfaCustomer, customer.sfaContact, customer.remarks, line.phone ?? "",
    line.numAtCard ?? "", line.remarks ?? "", line.salesEmployee, line.principal, line.itemCode, line.itemName, numberCell(line.quantity), numberCell(line.packSize), numberCell(measures.cases),
    line.whsCode ?? "", line.whsName ?? "", numberCell(line.priceBeforeDiscount), numberCell(line.price), numberCell(line.discountPct), numberCell(line.vatAmount),
    numberCell(line.salesAmount), numberCell(line.paidAmount), numberCell(measures.grossSales), numberCell(line.unitCost), numberCell(measures.cogs), numberCell(measures.grossProfit), line.createdBy ?? "", line.creationDate ?? "",
    line.costCentre1 ?? "", line.costCentre2 ?? "", line.costCentre3 ?? "",
  ];
}

/** A CSV cell. Text a spreadsheet would run as a formula gets a leading apostrophe; a phone number such as +2547... is left as it is. */
export function rawCsvCell(value: string | number): string {
  let text = String(value);
  if (typeof value === "string" && /^[=@\t\r]|^[+-](?![\d\s]*$)/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
