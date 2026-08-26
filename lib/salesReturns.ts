// Aggregation/query layer for the Sales & Returns page — reads SalesReturnLine,
// the table scripts/db-bridge/sales-returns populates from the field DMS
// (CASHMEMO_TYPE 01/06 = sales, 18/19 = credit notes for returns). Returns are
// stored with whatever sign the source system used for CD.AMOUNT; rather than
// assume a convention, every "returns" total here is reported as a magnitude
// (Math.abs), with document type — not sign — deciding which bucket a line
// falls into. netAfterReturns is therefore always salesNet - |returnsNet|.
import { prisma } from "@/lib/db";

const SALES_DOC_TYPES = ["01", "06"];
const RETURN_DOC_TYPES = ["18", "19"];

export interface SalesReturnsFilters {
  from: Date;
  /** Exclusive upper bound (the day after the selected "to" date). */
  toExclusive: Date;
  search: string | null;
  documentType: string | null;
}

export interface SalesReturnsSummary {
  salesGross: number;
  salesNet: number;
  salesQtyPieces: number;
  returnsGross: number;
  returnsNet: number;
  returnsQtyPieces: number;
  netAfterReturns: number;
  freeQtyPieces: number;
  totalDiscount: number;
  invoiceLineCount: number;
  returnLineCount: number;
}

export interface SalesReturnsTrendPoint {
  date: string;
  sales: number;
  returns: number;
}

export interface SalesReturnsRepRow {
  salesRepCode: string;
  salesRepName: string;
  sales: number;
  returns: number;
  net: number;
  lineCount: number;
}

export interface SalesReturnsDocTypeRow {
  documentType: string;
  documentTypeDesc: string;
  lineCount: number;
  netSale: number;
}

export interface SalesReturnLineRowDto {
  id: string;
  invoiceNo: string;
  invoiceDate: string | null;
  deliveryDate: string;
  documentType: string;
  documentTypeDesc: string;
  customerCode: string;
  salesRepCode: string;
  salesRepName: string;
  route: string | null;
  routeName: string;
  sku: string;
  skuDesc: string;
  storageLocation: string;
  saleQtyPieces: number;
  freeQtyPieces: number;
  grossSale: number;
  netSale: number;
  totalDiscount: number;
}

function whereFor(filters: SalesReturnsFilters, extraDocumentType?: string[]) {
  const where: Record<string, unknown> = {
    deliveryDate: { gte: filters.from, lt: filters.toExclusive },
  };
  const documentType = filters.documentType ? [filters.documentType] : extraDocumentType;
  if (documentType) where.documentType = { in: documentType };
  if (filters.search) {
    const q = filters.search;
    where.OR = [
      { customerCode: { contains: q, mode: "insensitive" } },
      { salesRepCode: { contains: q, mode: "insensitive" } },
      { salesRepName: { contains: q, mode: "insensitive" } },
      { sku: { contains: q, mode: "insensitive" } },
      { skuDesc: { contains: q, mode: "insensitive" } },
      { invoiceNo: { contains: q, mode: "insensitive" } },
    ];
  }
  return where;
}

export async function getSalesReturnsSummary(filters: SalesReturnsFilters): Promise<SalesReturnsSummary> {
  const [salesAgg, returnsAgg] = await Promise.all([
    prisma.salesReturnLine.aggregate({
      where: whereFor(filters, SALES_DOC_TYPES),
      _sum: { grossSale: true, netSale: true, saleQtyPieces: true, freeQtyPieces: true, totalDiscount: true },
      _count: true,
    }),
    prisma.salesReturnLine.aggregate({
      where: whereFor(filters, RETURN_DOC_TYPES),
      _sum: { grossSale: true, netSale: true, saleQtyPieces: true, totalDiscount: true },
      _count: true,
    }),
  ]);

  const salesNet = salesAgg._sum.netSale ?? 0;
  const returnsNet = Math.abs(returnsAgg._sum.netSale ?? 0);

  return {
    salesGross: salesAgg._sum.grossSale ?? 0,
    salesNet,
    salesQtyPieces: salesAgg._sum.saleQtyPieces ?? 0,
    returnsGross: Math.abs(returnsAgg._sum.grossSale ?? 0),
    returnsNet,
    returnsQtyPieces: Math.abs(returnsAgg._sum.saleQtyPieces ?? 0),
    netAfterReturns: salesNet - returnsNet,
    freeQtyPieces: salesAgg._sum.freeQtyPieces ?? 0,
    totalDiscount: (salesAgg._sum.totalDiscount ?? 0) + Math.abs(returnsAgg._sum.totalDiscount ?? 0),
    invoiceLineCount: salesAgg._count,
    returnLineCount: returnsAgg._count,
  };
}

export async function getSalesReturnsTrend(filters: SalesReturnsFilters): Promise<SalesReturnsTrendPoint[]> {
  const rows = await prisma.salesReturnLine.groupBy({
    by: ["deliveryDate", "documentType"],
    where: whereFor(filters),
    _sum: { netSale: true },
  });

  const byDate = new Map<string, { sales: number; returns: number }>();
  for (const row of rows) {
    const key = row.deliveryDate.toISOString().slice(0, 10);
    const acc = byDate.get(key) ?? { sales: 0, returns: 0 };
    const value = row._sum.netSale ?? 0;
    if (SALES_DOC_TYPES.includes(row.documentType)) acc.sales += value;
    else if (RETURN_DOC_TYPES.includes(row.documentType)) acc.returns += Math.abs(value);
    byDate.set(key, acc);
  }

  return Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, acc]) => ({ date, ...acc }));
}

export async function getSalesReturnsByRep(filters: SalesReturnsFilters): Promise<SalesReturnsRepRow[]> {
  const rows = await prisma.salesReturnLine.groupBy({
    by: ["salesRepCode", "salesRepName", "documentType"],
    where: whereFor(filters),
    _sum: { netSale: true },
    _count: true,
  });

  const byRep = new Map<string, SalesReturnsRepRow>();
  for (const row of rows) {
    const acc = byRep.get(row.salesRepCode) ?? {
      salesRepCode: row.salesRepCode,
      salesRepName: row.salesRepName,
      sales: 0,
      returns: 0,
      net: 0,
      lineCount: 0,
    };
    const value = row._sum.netSale ?? 0;
    if (SALES_DOC_TYPES.includes(row.documentType)) acc.sales += value;
    else if (RETURN_DOC_TYPES.includes(row.documentType)) acc.returns += Math.abs(value);
    acc.lineCount += row._count;
    byRep.set(row.salesRepCode, acc);
  }

  return Array.from(byRep.values())
    .map((r) => ({ ...r, net: r.sales - r.returns }))
    .sort((a, b) => b.net - a.net);
}

export async function getSalesReturnsByDocType(filters: SalesReturnsFilters): Promise<SalesReturnsDocTypeRow[]> {
  const rows = await prisma.salesReturnLine.groupBy({
    by: ["documentType", "documentTypeDesc"],
    where: whereFor(filters),
    _sum: { netSale: true },
    _count: true,
  });
  return rows
    .map((r) => ({
      documentType: r.documentType,
      documentTypeDesc: r.documentTypeDesc,
      lineCount: r._count,
      netSale: r._sum.netSale ?? 0,
    }))
    .sort((a, b) => a.documentType.localeCompare(b.documentType));
}

export async function getSalesReturnLines(
  filters: SalesReturnsFilters,
  page: number,
  pageSize: number
): Promise<{ rows: SalesReturnLineRowDto[]; total: number }> {
  const where = whereFor(filters);
  const [rows, total] = await Promise.all([
    prisma.salesReturnLine.findMany({
      where,
      orderBy: { deliveryDate: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.salesReturnLine.count({ where }),
  ]);

  return {
    total,
    rows: rows.map((r) => ({
      id: r.id,
      invoiceNo: r.invoiceNo,
      invoiceDate: r.invoiceDate ? r.invoiceDate.toISOString().slice(0, 10) : null,
      deliveryDate: r.deliveryDate.toISOString().slice(0, 10),
      documentType: r.documentType,
      documentTypeDesc: r.documentTypeDesc,
      customerCode: r.customerCode,
      salesRepCode: r.salesRepCode,
      salesRepName: r.salesRepName,
      route: r.route,
      routeName: r.routeName,
      sku: r.sku,
      skuDesc: r.skuDesc,
      storageLocation: r.storageLocation,
      saleQtyPieces: r.saleQtyPieces,
      freeQtyPieces: r.freeQtyPieces,
      grossSale: r.grossSale,
      netSale: r.netSale,
      totalDiscount: r.totalDiscount,
    })),
  };
}

export async function getAvailableDocumentTypes(): Promise<{ documentType: string; documentTypeDesc: string }[]> {
  const rows = await prisma.salesReturnLine.groupBy({ by: ["documentType", "documentTypeDesc"] });
  return rows.sort((a, b) => a.documentType.localeCompare(b.documentType));
}
