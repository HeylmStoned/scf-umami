/** Upper bounds in milliseconds. The last bucket is the overflow ceiling. */
export const LATENCY_BUCKETS_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000] as const;

export function bucketIndex(durationMs: number): number {
  const index = LATENCY_BUCKETS_MS.findIndex((bound) => durationMs <= bound);
  return index === -1 ? LATENCY_BUCKETS_MS.length - 1 : index;
}

export function emptyCounts(): number[] {
  return LATENCY_BUCKETS_MS.map(() => 0);
}

/** Histogram percentile: the bucket upper bound that covers the requested rank. */
export function percentile(counts: number[], p: number): number | null {
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (total === 0) return null;
  const target = Math.ceil((total * p) / 100);
  let seen = 0;
  for (let i = 0; i < counts.length; i += 1) {
    seen += counts[i] ?? 0;
    if (seen >= target) return LATENCY_BUCKETS_MS[i] ?? null;
  }
  return LATENCY_BUCKETS_MS[LATENCY_BUCKETS_MS.length - 1] ?? null;
}
