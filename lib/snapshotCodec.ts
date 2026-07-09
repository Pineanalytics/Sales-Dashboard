// The Snapshot.data column stores the entire Dataset as one JSON blob — a
// single row's actual content is large enough (thousands of coverage/brand-
// customer rows, 1500+ stock items) that reading it uncompressed measured
// ~17s in production (confirmed via Supabase's own postgres query log: the
// query PLAN is trivially cheap — an index scan returning exactly 1 row —
// so the time is spent reading/transmitting the oversized TEXT value itself,
// not query planning). JSON compresses very well (typically 80-90%), so
// gzip-compressing before storage and decompressing on read cuts that
// transfer size dramatically.
//
// Encoded rows are prefixed with GZIP_PREFIX so existing uncompressed rows
// (written before this change) keep reading correctly — raw JSON always
// starts with "{", never with the prefix.
import { gzipSync, gunzipSync } from "node:zlib";
import type { Dataset } from "./types";

const GZIP_PREFIX = "gz1:";

export function encodeDataset(dataset: Dataset): string {
  const compressed = gzipSync(Buffer.from(JSON.stringify(dataset), "utf8"));
  return GZIP_PREFIX + compressed.toString("base64");
}

export function decodeDataset(raw: string): Dataset {
  if (raw.startsWith(GZIP_PREFIX)) {
    const compressed = Buffer.from(raw.slice(GZIP_PREFIX.length), "base64");
    const json = gunzipSync(compressed).toString("utf8");
    return JSON.parse(json) as Dataset;
  }
  // Legacy uncompressed row, written before this change.
  return JSON.parse(raw) as Dataset;
}
