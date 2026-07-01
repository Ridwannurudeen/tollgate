type RateLimitBucket = {
  windowStart: number;
  count: number;
};

const QUERY_WINDOW_MS = 60_000;
const QUERY_LIMIT = 12;
const buckets = new Map<string, RateLimitBucket>();

export function assertQueryRateLimit(key: string, now = Date.now()): void {
  const bucketKey = key || "anonymous";
  for (const [existingKey, bucket] of buckets) {
    if (now - bucket.windowStart >= QUERY_WINDOW_MS) {
      buckets.delete(existingKey);
    }
  }
  const current = buckets.get(bucketKey);
  if (!current || now - current.windowStart >= QUERY_WINDOW_MS) {
    buckets.set(bucketKey, { windowStart: now, count: 1 });
    return;
  }
  if (current.count >= QUERY_LIMIT) {
    throw new Error("Too many free query attempts. Wait a minute and retry.");
  }
  current.count += 1;
}
