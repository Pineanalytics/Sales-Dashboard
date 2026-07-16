/** Fetches an entire table in bounded chunks via skip/take rather than one unbounded
 *  findMany() — large/growing bridge tables (ActiveOutlet, RepCall) risk tripping
 *  Postgres' statement_timeout under any concurrent load if pulled in a single query
 *  (observed directly in Supabase's logs: repeated "canceling statement due to
 *  statement timeout" once ActiveOutlet passed ~70K rows). Each chunk stays well
 *  under that cap; the caller still gets the full array back, so nothing downstream
 *  of the route needs to change. Sequential, not parallel — the pooled connection
 *  limit is small, and concurrent chunk queries would just re-create the same
 *  contention this is meant to avoid. */
export async function fetchAllInChunks<T>(
  fetchPage: (args: { skip: number; take: number }) => Promise<T[]>,
  chunkSize = 5000
): Promise<T[]> {
  const results: T[] = [];
  let skip = 0;
  for (;;) {
    const batch = await fetchPage({ skip, take: chunkSize });
    results.push(...batch);
    if (batch.length < chunkSize) break;
    skip += chunkSize;
  }
  return results;
}
