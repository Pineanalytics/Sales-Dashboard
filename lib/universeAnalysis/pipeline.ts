// End to end: de-duplicate -> collapse -> enrich. Run once per refresh and cache the result; every screen is served from it.
import { collapse } from "./collapse";
import { DEFAULT_DEDUP, SOURCE_PREFIX, type DedupRules } from "./config";
import { deduplicate } from "./dedup";
import { enrich } from "./enrich";
import type { DedupPair, DedupRecord, ExtractRow, FactRow } from "./types";

export interface PipelineResult {
  raw: ExtractRow[];
  records: DedupRecord[];
  pairs: DedupPair[];
  fact: FactRow[];
}

/** A record key unique across systems (outlet ids from different systems can collide). */
export function recordKey(source: string, outletId: string): string {
  return `${SOURCE_PREFIX[source] ?? "OTH"}-${outletId.trim()}`;
}

export function runPipeline(raw: ExtractRow[], rules: DedupRules = DEFAULT_DEDUP): PipelineResult {
  const { records, pairs } = deduplicate(raw, rules);
  const unique = collapse(raw, records);
  const fact = enrich(unique);
  return { raw, records, pairs, fact };
}
