import { prisma } from "./db";
import { normalizePrincipalKey } from "./normalize";
import type { Dataset, DatasetSnapshotSummary, MonthlyPLRow, PLLineType } from "./types";

export async function saveSnapshot(dataset: Dataset): Promise<DatasetSnapshotSummary> {
  const snapshot = await prisma.snapshot.create({
    data: {
      uploadedAt: new Date(dataset.uploadedAt),
      reportTitle: dataset.reportMeta.title || "Untitled Report",
      data: JSON.stringify(dataset),
    },
  });
  return {
    id: snapshot.id,
    uploadedAt: snapshot.uploadedAt.toISOString(),
    reportTitle: snapshot.reportTitle,
  };
}

/** Overlays admin-uploaded Target rows onto monthlySales[].target, keyed by
 *  (year, month, principal). A DB row only wins when it exists AND has a
 *  non-null valueTarget — a Target row that only captured e.g. Volume Target
 *  that month falls through to whatever the Snapshot already had, rather than
 *  nulling out a perfectly good value. */
async function overlayTargets(dataset: Dataset): Promise<Dataset> {
  const targets = await prisma.target.findMany();
  if (targets.length === 0) return dataset;

  const byKey = new Map(targets.map((t) => [`${t.year}|${t.month}|${t.principal}`, t.valueTarget]));

  return {
    ...dataset,
    monthlySales: dataset.monthlySales.map((row) => {
      const dbTarget = byKey.get(`${row.year}|${row.month}|${row.principal}`);
      return dbTarget !== undefined && dbTarget !== null ? { ...row, target: dbTarget } : row;
    }),
  };
}

/** Attaches admin/pl-bridge-sourced P&L rows as dataset.monthlyPL. Unlike targets,
 *  there's nothing to fall back to — the Excel upload path never produces P&L data,
 *  so this always fully replaces whatever monthlyPL the Snapshot happened to have. */
async function overlayPL(dataset: Dataset): Promise<Dataset> {
  const rows = await prisma.pLEntry.findMany();
  const monthlyPL: MonthlyPLRow[] = rows.map((r) => ({
    year: r.year,
    month: r.month,
    monthIndex: r.monthIndex,
    principal: r.principal,
    principalKey: normalizePrincipalKey(r.principal),
    accountCode: r.accountCode,
    accountName: r.accountName,
    lineType: r.lineType as PLLineType,
    amount: r.amount,
  }));
  return { ...dataset, monthlyPL };
}

async function overlayAdminData(dataset: Dataset): Promise<Dataset> {
  const [withTargets, withPL] = await Promise.all([overlayTargets(dataset), overlayPL(dataset)]);
  return { ...withTargets, monthlyPL: withPL.monthlyPL };
}

export async function getLatestSnapshot(): Promise<Dataset | null> {
  const snapshot = await prisma.snapshot.findFirst({ orderBy: { uploadedAt: "desc" } });
  if (!snapshot) return null;
  return overlayAdminData(JSON.parse(snapshot.data) as Dataset);
}

export async function getSnapshotById(id: string): Promise<Dataset | null> {
  const snapshot = await prisma.snapshot.findUnique({ where: { id } });
  if (!snapshot) return null;
  return overlayAdminData(JSON.parse(snapshot.data) as Dataset);
}

export async function listSnapshots(limit = 20): Promise<DatasetSnapshotSummary[]> {
  const snapshots = await prisma.snapshot.findMany({
    orderBy: { uploadedAt: "desc" },
    take: limit,
    select: { id: true, uploadedAt: true, reportTitle: true },
  });
  return snapshots.map((s) => ({
    id: s.id,
    uploadedAt: s.uploadedAt.toISOString(),
    reportTitle: s.reportTitle,
  }));
}
