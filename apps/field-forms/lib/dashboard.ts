export interface SubmissionRow {
  id: string;
  submittedAt: string;
  answers: Record<string, string>;
  merchandiserCode?: string | null;
}

export interface Count {
  label: string;
  count: number;
}

export function countByField(rows: SubmissionRow[], fieldId: string): Count[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const v = r.answers[fieldId];
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

export function countByMultiField(rows: SubmissionRow[], fieldId: string): Count[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const v = r.answers[fieldId];
    if (!v) continue;
    for (const item of v.split(",").map((s) => s.trim()).filter(Boolean)) {
      counts.set(item, (counts.get(item) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

// For ordinal scales (positioning 1-5, shelf-space bands) — preserve the
// field's own option order instead of sorting by frequency.
export function countsInOptionOrder(
  rows: SubmissionRow[],
  fieldId: string,
  options: string[]
): Count[] {
  const byLabel = new Map(countByField(rows, fieldId).map((c) => [c.label, c.count]));
  return options.map((label) => ({ label, count: byLabel.get(label) ?? 0 }));
}

export function averageNumeric(rows: SubmissionRow[], fieldId: string): number | null {
  const nums = rows
    .map((r) => parseFloat(r.answers[fieldId]))
    .filter((n) => isFinite(n));
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export function uniqueValueCount(rows: SubmissionRow[], fieldId: string): number {
  return new Set(rows.map((r) => r.answers[fieldId]).filter(Boolean)).size;
}

export function dailyCounts(
  rows: SubmissionRow[],
  days = 14
): { date: string; count: number }[] {
  const buckets = new Map<string, number>();
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    buckets.set(d.toISOString().slice(0, 10), 0);
  }
  for (const r of rows) {
    const key = r.submittedAt.slice(0, 10);
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  return [...buckets.entries()].map(([date, count]) => ({ date, count }));
}

// Only the dates that actually have activity — unlike dailyCounts, this
// doesn't zero-fill a fixed window, so a bursty submission pattern reads
// as a handful of tall bars rather than mostly-empty noise.
export function visitsByDate(rows: SubmissionRow[]): { date: string; count: number }[] {
  const buckets = new Map<string, number>();
  for (const r of rows) {
    const key = r.submittedAt.slice(0, 10);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, count]) => ({ date, count }));
}

// Fraction of rows where fieldId's answer equals value (only counting rows
// that answered the field at all).
export function rateOfValue(
  rows: SubmissionRow[],
  fieldId: string,
  value: string
): { count: number; total: number; rate: number } {
  let count = 0;
  let total = 0;
  for (const r of rows) {
    const v = r.answers[fieldId];
    if (!v) continue;
    total++;
    if (v === value) count++;
  }
  return { count, total, rate: total ? count / total : 0 };
}

// Fields with a "Pick from list, if unavailable Add New" pattern store the
// free-text fallback in a separate field when the select is "Other" (or
// "Other (not listed)"). This resolves the value someone would actually
// recognize as the outlet/retailer name.
export function effectiveLabel(raw?: string, otherRaw?: string): string {
  if (!raw) return "";
  if (raw.toLowerCase().startsWith("other") && otherRaw) return otherRaw.trim();
  return raw;
}

export interface OutletSummary {
  outlet: string;
  retailer: string;
  region: string;
  visits: number;
  lastVisit: string;
  avgSharePct: number | null;
  oosYes: number;
  oosTotal: number;
  avgPositioning: number | null;
  delivered: number;
  deliveryTotal: number;
  avgShelfOccupiedPct: number | null;
}

export interface OutletFieldIds {
  location: string;
  locationOther?: string;
  retailer?: string;
  retailerOther?: string;
  region?: string;
  sharePct?: string;
  oos?: string;
  positioning?: string;
  delivery?: string;
  shelfSpace?: string;
}

export function buildOutletSummaries(
  rows: SubmissionRow[],
  f: OutletFieldIds
): OutletSummary[] {
  interface Acc extends OutletSummary {
    shareSum: number;
    shareCount: number;
    posSum: number;
    posCount: number;
    occSum: number;
    occCount: number;
  }
  const map = new Map<string, Acc>();

  for (const r of rows) {
    const outlet = effectiveLabel(
      r.answers[f.location],
      f.locationOther ? r.answers[f.locationOther] : undefined
    );
    if (!outlet) continue;

    let entry = map.get(outlet);
    if (!entry) {
      entry = {
        outlet,
        retailer: f.retailer
          ? effectiveLabel(
              r.answers[f.retailer],
              f.retailerOther ? r.answers[f.retailerOther] : undefined
            )
          : "",
        region: f.region ? r.answers[f.region] ?? "" : "",
        visits: 0,
        lastVisit: r.submittedAt,
        avgSharePct: null,
        oosYes: 0,
        oosTotal: 0,
        avgPositioning: null,
        delivered: 0,
        deliveryTotal: 0,
        avgShelfOccupiedPct: null,
        shareSum: 0,
        shareCount: 0,
        posSum: 0,
        posCount: 0,
        occSum: 0,
        occCount: 0,
      };
      map.set(outlet, entry);
    }

    entry.visits++;
    if (new Date(r.submittedAt) > new Date(entry.lastVisit)) {
      entry.lastVisit = r.submittedAt;
    }
    if (f.sharePct) {
      const v = parseFloat(r.answers[f.sharePct]);
      if (isFinite(v)) {
        entry.shareSum += v;
        entry.shareCount++;
      }
    }
    if (f.oos && r.answers[f.oos]) {
      entry.oosTotal++;
      if (r.answers[f.oos] === "Yes") entry.oosYes++;
    }
    if (f.positioning) {
      const v = parseFloat(r.answers[f.positioning]);
      if (isFinite(v)) {
        entry.posSum += v;
        entry.posCount++;
      }
    }
    if (f.delivery && r.answers[f.delivery]) {
      entry.deliveryTotal++;
      if (r.answers[f.delivery] === "Order Delivered") entry.delivered++;
    }
    if (f.shelfSpace) {
      const v = parseFloat(r.answers[f.shelfSpace]);
      if (isFinite(v)) {
        entry.occSum += v;
        entry.occCount++;
      }
    }
  }

  return [...map.values()]
    .map((e) => ({
      outlet: e.outlet,
      retailer: e.retailer,
      region: e.region,
      visits: e.visits,
      lastVisit: e.lastVisit,
      avgSharePct: e.shareCount ? e.shareSum / e.shareCount : null,
      oosYes: e.oosYes,
      oosTotal: e.oosTotal,
      avgPositioning: e.posCount ? e.posSum / e.posCount : null,
      delivered: e.delivered,
      deliveryTotal: e.deliveryTotal,
      avgShelfOccupiedPct: e.occCount ? e.occSum / e.occCount : null,
    }))
    .sort(
      (a, b) => new Date(b.lastVisit).getTime() - new Date(a.lastVisit).getTime()
    );
}

export interface PhotoEntry {
  submissionId: string;
  url: string;
  outlet: string;
  retailer: string;
  submittedAt: string;
}

export interface GroupSummary {
  key: string;
  visits: number;
  lastVisit: string;
  avgSharePct: number | null;
  oosYes: number;
  oosTotal: number;
  avgPositioning: number | null;
  uniqueOutlets: number;
  delivered: number;
  deliveryTotal: number;
  avgShelfOccupiedPct: number | null;
}

export interface GroupFieldIds {
  group: string;
  groupOther?: string;
  outlet?: string;
  outletOther?: string;
  sharePct?: string;
  oos?: string;
  positioning?: string;
  delivery?: string;
  shelfSpace?: string;
}

// Generic "group visits by X and roll up the same health metrics" used for
// both the retailer and merchandiser drill-down modules.
export function buildGroupSummaries(
  rows: SubmissionRow[],
  f: GroupFieldIds
): GroupSummary[] {
  interface Acc extends GroupSummary {
    shareSum: number;
    shareCount: number;
    posSum: number;
    posCount: number;
    occSum: number;
    occCount: number;
    outletSet: Set<string>;
  }
  const map = new Map<string, Acc>();

  for (const r of rows) {
    const key = effectiveLabel(
      r.answers[f.group],
      f.groupOther ? r.answers[f.groupOther] : undefined
    );
    if (!key) continue;

    let entry = map.get(key);
    if (!entry) {
      entry = {
        key,
        visits: 0,
        lastVisit: r.submittedAt,
        avgSharePct: null,
        oosYes: 0,
        oosTotal: 0,
        avgPositioning: null,
        uniqueOutlets: 0,
        delivered: 0,
        deliveryTotal: 0,
        avgShelfOccupiedPct: null,
        shareSum: 0,
        shareCount: 0,
        posSum: 0,
        posCount: 0,
        occSum: 0,
        occCount: 0,
        outletSet: new Set(),
      };
      map.set(key, entry);
    }

    entry.visits++;
    if (new Date(r.submittedAt) > new Date(entry.lastVisit)) {
      entry.lastVisit = r.submittedAt;
    }
    if (f.outlet) {
      const outlet = effectiveLabel(
        r.answers[f.outlet],
        f.outletOther ? r.answers[f.outletOther] : undefined
      );
      if (outlet) entry.outletSet.add(outlet);
    }
    if (f.sharePct) {
      const v = parseFloat(r.answers[f.sharePct]);
      if (isFinite(v)) {
        entry.shareSum += v;
        entry.shareCount++;
      }
    }
    if (f.oos && r.answers[f.oos]) {
      entry.oosTotal++;
      if (r.answers[f.oos] === "Yes") entry.oosYes++;
    }
    if (f.positioning) {
      const v = parseFloat(r.answers[f.positioning]);
      if (isFinite(v)) {
        entry.posSum += v;
        entry.posCount++;
      }
    }
    if (f.delivery && r.answers[f.delivery]) {
      entry.deliveryTotal++;
      if (r.answers[f.delivery] === "Order Delivered") entry.delivered++;
    }
    if (f.shelfSpace) {
      const v = parseFloat(r.answers[f.shelfSpace]);
      if (isFinite(v)) {
        entry.occSum += v;
        entry.occCount++;
      }
    }
  }

  return [...map.values()]
    .map((e) => ({
      key: e.key,
      visits: e.visits,
      lastVisit: e.lastVisit,
      avgSharePct: e.shareCount ? e.shareSum / e.shareCount : null,
      oosYes: e.oosYes,
      oosTotal: e.oosTotal,
      avgPositioning: e.posCount ? e.posSum / e.posCount : null,
      uniqueOutlets: e.outletSet.size,
      delivered: e.delivered,
      deliveryTotal: e.deliveryTotal,
      avgShelfOccupiedPct: e.occCount ? e.occSum / e.occCount : null,
    }))
    .sort(
      (a, b) => new Date(b.lastVisit).getTime() - new Date(a.lastVisit).getTime()
    );
}

// Rows whose (possibly Other-resolved) value for `fieldId` matches `value`.
export function filterByEffectiveValue(
  rows: SubmissionRow[],
  fieldId: string,
  otherFieldId: string | undefined,
  value: string
): SubmissionRow[] {
  return rows.filter(
    (r) =>
      effectiveLabel(
        r.answers[fieldId],
        otherFieldId ? r.answers[otherFieldId] : undefined
      ) === value
  );
}

export function formatRelativeTime(dateStr: string): string {
  const then = new Date(dateStr).getTime();
  const diffMs = Date.now() - then;
  const sec = Math.round(diffMs / 1000);
  if (sec < 45) return "just now";
  const min = Math.round(sec / 60);
  if (min < 45) return `${min} min${min === 1 ? "" : "s"} ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day} day${day === 1 ? "" : "s"} ago`;
  const week = Math.round(day / 7);
  if (day < 30) return `${week} week${week === 1 ? "" : "s"} ago`;
  const month = Math.round(day / 30);
  if (day < 365) return `${month} month${month === 1 ? "" : "s"} ago`;
  const year = Math.round(day / 365);
  return `${year} year${year === 1 ? "" : "s"} ago`;
}

export function buildPhotoFeed(
  rows: SubmissionRow[],
  photoFieldId: string,
  f: Pick<OutletFieldIds, "location" | "locationOther" | "retailer" | "retailerOther">
): PhotoEntry[] {
  return rows
    .filter((r) => r.answers[photoFieldId])
    .map((r) => ({
      submissionId: r.id,
      url: r.answers[photoFieldId],
      outlet: effectiveLabel(
        r.answers[f.location],
        f.locationOther ? r.answers[f.locationOther] : undefined
      ),
      retailer: f.retailer
        ? effectiveLabel(
            r.answers[f.retailer],
            f.retailerOther ? r.answers[f.retailerOther] : undefined
          )
        : "",
      submittedAt: r.submittedAt,
    }))
    .sort(
      (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
    );
}
