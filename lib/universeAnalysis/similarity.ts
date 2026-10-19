// String similarity for outlet names: the normalised Indel ratio (what rapidfuzz's fuzz.ratio computes), 2 * LCS / (len a + len b), in 0..1.

export function lcsLength(a: string, b: string): number {
  if (a.length === 0 || b.length === 0) return 0;
  // Keep the shorter string on the inner loop so the rolling row stays small.
  const [s, t] = a.length >= b.length ? [a, b] : [b, a];
  let prev = new Uint16Array(t.length + 1);
  let cur = new Uint16Array(t.length + 1);
  for (let i = 1; i <= s.length; i++) {
    const ci = s.charCodeAt(i - 1);
    for (let j = 1; j <= t.length; j++) {
      cur[j] = ci === t.charCodeAt(j - 1) ? prev[j - 1] + 1 : cur[j - 1] > prev[j] ? cur[j - 1] : prev[j];
    }
    const swap = prev;
    prev = cur;
    cur = swap;
  }
  return prev[t.length];
}

export function similarity(a: string, b: string): number {
  const total = a.length + b.length;
  if (total === 0) return 1;
  return (2 * lcsLength(a, b)) / total;
}
