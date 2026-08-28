export const UPFIELD_SOURCE = "upfield-dataedge";
export const UPFIELD_MAX_BATCH_SIZE = 2000;

export interface UpfieldUploadRecord {
  sourceRecordId: string;
  type: "sale" | "return";
  txnDate: string;
  invoiceNo: string;
  docNo: string;
  custCode: string | null;
  custName: string | null;
  itemCode: string;
  itemDesc: string | null;
  itemPrice: number | null;
  qty: number | null;
  saleExcl: number | null;
  disc: number | null;
  vat: number | null;
  saleIncl: number | null;
  fsr: string | null;
  printedBy: string | null;
  sourceFile: string | null;
}

export interface UpfieldUploadBatch {
  source: typeof UPFIELD_SOURCE;
  syncRunId: string;
  windowStart: string;
  windowEnd: string;
  batchNumber: number;
  isFinalBatch: boolean;
  recordCount: number;
  records: UpfieldUploadRecord[];
}

export type UpfieldBatchValidation =
  | { ok: true; batch: UpfieldUploadBatch; windowStart: Date; windowEnd: Date }
  | { ok: false; error: string };

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function nullableFiniteNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

// A source invoice can legitimately list the same natural key twice (e.g. a
// zero-priced/free unit alongside the real priced line, confirmed live in
// real DataEdge data) - the 2nd+ occurrence is disambiguated client-side
// with a `|N` suffix (N >= 2). Accept both the bare id and that suffixed
// form, not just an exact match. Shared by the sales and visits validators.
function isSourceRecordIdMatch(sourceRecordId: string, expectedBase: string): boolean {
  if (sourceRecordId === expectedBase) return true;
  if (!sourceRecordId.startsWith(`${expectedBase}|`)) return false;
  const suffix = sourceRecordId.slice(expectedBase.length + 1);
  return /^[2-9]\d*$/.test(suffix);
}

function validateRecord(value: unknown, index: number): string | null {
  if (!value || typeof value !== "object") return `records[${index}] must be an object.`;
  const row = value as Record<string, unknown>;
  for (const field of ["sourceRecordId", "txnDate", "invoiceNo", "docNo", "itemCode"] as const) {
    if (!nonEmptyString(row[field])) return `records[${index}].${field} must be a non-empty string.`;
  }
  if (row.type !== "sale" && row.type !== "return") return `records[${index}].type must be "sale" or "return".`;
  if (Number.isNaN(new Date(row.txnDate as string).getTime())) return `records[${index}].txnDate must be a valid ISO timestamp.`;
  const expectedId = `${row.invoiceNo}|${row.itemCode}|${row.docNo}`;
  if (!isSourceRecordIdMatch(row.sourceRecordId as string, expectedId)) {
    return `records[${index}].sourceRecordId must equal invoiceNo|itemCode|docNo, optionally suffixed with |N (N >= 2) for a repeated line within the same invoice/item/doc.`;
  }
  for (const field of ["custCode", "custName", "itemDesc", "fsr", "printedBy", "sourceFile"] as const) {
    if (!nullableString(row[field])) return `records[${index}].${field} must be a string or null.`;
  }
  for (const field of ["itemPrice", "qty", "saleExcl", "disc", "vat", "saleIncl"] as const) {
    if (!nullableFiniteNumber(row[field])) return `records[${index}].${field} must be a finite number or null.`;
  }
  return null;
}

export function validateUpfieldUploadBatch(value: unknown): UpfieldBatchValidation {
  if (!value || typeof value !== "object") return { ok: false, error: "Expected a JSON object." };
  const body = value as Record<string, unknown>;
  if (body.source !== UPFIELD_SOURCE) return { ok: false, error: `source must be "${UPFIELD_SOURCE}".` };
  if (!nonEmptyString(body.syncRunId)) return { ok: false, error: "syncRunId must be a non-empty string." };
  if (!nonEmptyString(body.windowStart) || !nonEmptyString(body.windowEnd)) return { ok: false, error: "windowStart and windowEnd must be ISO timestamps." };
  const windowStart = new Date(body.windowStart);
  const windowEnd = new Date(body.windowEnd);
  if (Number.isNaN(windowStart.getTime()) || Number.isNaN(windowEnd.getTime()) || windowEnd < windowStart) {
    return { ok: false, error: "windowStart/windowEnd must be a valid, ordered ISO range." };
  }
  if (!Number.isInteger(body.batchNumber) || (body.batchNumber as number) < 1) return { ok: false, error: "batchNumber must be a positive integer." };
  if (typeof body.isFinalBatch !== "boolean") return { ok: false, error: "isFinalBatch must be a boolean." };
  if (!Array.isArray(body.records)) return { ok: false, error: "records must be an array." };
  if (body.records.length > UPFIELD_MAX_BATCH_SIZE) return { ok: false, error: `records cannot exceed ${UPFIELD_MAX_BATCH_SIZE} rows per batch.` };
  if (!Number.isInteger(body.recordCount) || body.recordCount !== body.records.length) return { ok: false, error: "recordCount must equal records.length." };
  if (body.records.length === 0 && body.isFinalBatch !== true) return { ok: false, error: "Only a final batch may contain zero records." };
  const ids = new Set<string>();
  for (let index = 0; index < body.records.length; index += 1) {
    const error = validateRecord(body.records[index], index);
    if (error) return { ok: false, error };
    const id = (body.records[index] as { sourceRecordId: string }).sourceRecordId;
    if (ids.has(id)) return { ok: false, error: `Duplicate sourceRecordId in batch: ${id}.` };
    ids.add(id);
  }
  return {
    ok: true,
    batch: body as unknown as UpfieldUploadBatch,
    windowStart,
    windowEnd,
  };
}

// --- Upfield Timestamp Report (Outlet Visit Detail) -------------------------
// A separate feed from SalesRawData: FSR outlet-visit check-in/check-out
// data, uploaded by F:\UpfieldSalesRawData 4x/day (10:00/12:00/17:00/20:00
// Africa/Nairobi). Shares the UpfieldSyncRun/UpfieldSyncBatch/SyncWatermark
// machinery above (distinct source/bridge value keeps it from ever
// colliding with the sales sync), but has its own record shape, natural
// key, and target table (UpfieldVisit).

export const UPFIELD_VISITS_SOURCE = "upfield-visits";

export interface UpfieldVisitUploadRecord {
  sourceRecordId: string;
  fsr: string;
  distributor: string | null;
  pop: string;
  startTime: string;
  endTime: string | null;
  timeInOutlet: string | null;
  transitTime: string | null;
  lppc: number | null;
  sale: number | null;
  sourceFile: string | null;
}

export interface UpfieldVisitUploadBatch {
  source: typeof UPFIELD_VISITS_SOURCE;
  syncRunId: string;
  windowStart: string;
  windowEnd: string;
  batchNumber: number;
  isFinalBatch: boolean;
  recordCount: number;
  records: UpfieldVisitUploadRecord[];
}

export type UpfieldVisitBatchValidation =
  | { ok: true; batch: UpfieldVisitUploadBatch; windowStart: Date; windowEnd: Date }
  | { ok: false; error: string };

function validateVisitRecord(value: unknown, index: number): string | null {
  if (!value || typeof value !== "object") return `records[${index}] must be an object.`;
  const row = value as Record<string, unknown>;
  for (const field of ["sourceRecordId", "fsr", "pop", "startTime"] as const) {
    if (!nonEmptyString(row[field])) return `records[${index}].${field} must be a non-empty string.`;
  }
  if (Number.isNaN(new Date(row.startTime as string).getTime())) {
    return `records[${index}].startTime must be a valid ISO timestamp.`;
  }
  const expectedId = `${row.fsr}|${row.pop}|${row.startTime}`;
  if (!isSourceRecordIdMatch(row.sourceRecordId as string, expectedId)) {
    return `records[${index}].sourceRecordId must equal fsr|pop|startTime, optionally suffixed with |N (N >= 2) for a repeated visit key.`;
  }
  if (row.endTime !== null && !nonEmptyString(row.endTime)) {
    return `records[${index}].endTime must be a string or null.`;
  }
  if (row.endTime !== null && Number.isNaN(new Date(row.endTime as string).getTime())) {
    return `records[${index}].endTime must be a valid ISO timestamp or null.`;
  }
  for (const field of ["distributor", "timeInOutlet", "transitTime", "sourceFile"] as const) {
    if (!nullableString(row[field])) return `records[${index}].${field} must be a string or null.`;
  }
  for (const field of ["lppc", "sale"] as const) {
    if (!nullableFiniteNumber(row[field])) return `records[${index}].${field} must be a finite number or null.`;
  }
  return null;
}

export function validateUpfieldVisitUploadBatch(value: unknown): UpfieldVisitBatchValidation {
  if (!value || typeof value !== "object") return { ok: false, error: "Expected a JSON object." };
  const body = value as Record<string, unknown>;
  if (body.source !== UPFIELD_VISITS_SOURCE) return { ok: false, error: `source must be "${UPFIELD_VISITS_SOURCE}".` };
  if (!nonEmptyString(body.syncRunId)) return { ok: false, error: "syncRunId must be a non-empty string." };
  if (!nonEmptyString(body.windowStart) || !nonEmptyString(body.windowEnd)) return { ok: false, error: "windowStart and windowEnd must be ISO timestamps." };
  const windowStart = new Date(body.windowStart);
  const windowEnd = new Date(body.windowEnd);
  if (Number.isNaN(windowStart.getTime()) || Number.isNaN(windowEnd.getTime()) || windowEnd < windowStart) {
    return { ok: false, error: "windowStart/windowEnd must be a valid, ordered ISO range." };
  }
  if (!Number.isInteger(body.batchNumber) || (body.batchNumber as number) < 1) return { ok: false, error: "batchNumber must be a positive integer." };
  if (typeof body.isFinalBatch !== "boolean") return { ok: false, error: "isFinalBatch must be a boolean." };
  if (!Array.isArray(body.records)) return { ok: false, error: "records must be an array." };
  if (body.records.length > UPFIELD_MAX_BATCH_SIZE) return { ok: false, error: `records cannot exceed ${UPFIELD_MAX_BATCH_SIZE} rows per batch.` };
  if (!Number.isInteger(body.recordCount) || body.recordCount !== body.records.length) return { ok: false, error: "recordCount must equal records.length." };
  if (body.records.length === 0 && body.isFinalBatch !== true) return { ok: false, error: "Only a final batch may contain zero records." };
  const ids = new Set<string>();
  for (let index = 0; index < body.records.length; index += 1) {
    const error = validateVisitRecord(body.records[index], index);
    if (error) return { ok: false, error };
    const id = (body.records[index] as { sourceRecordId: string }).sourceRecordId;
    if (ids.has(id)) return { ok: false, error: `Duplicate sourceRecordId in batch: ${id}.` };
    ids.add(id);
  }
  return {
    ok: true,
    batch: body as unknown as UpfieldVisitUploadBatch,
    windowStart,
    windowEnd,
  };
}
