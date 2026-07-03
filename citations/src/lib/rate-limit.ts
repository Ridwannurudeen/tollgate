type RateLimitBucket = {
  windowStart: number;
  count: number;
};

const QUERY_WINDOW_MS = 60_000;
const QUERY_LIMIT = 12;
const REGISTRATION_WINDOW_MS = 24 * 60 * 60 * 1000;
const REGISTRATION_LIMIT = 20;
const CLAIM_WINDOW_MS = 60 * 60 * 1000;
const CLAIM_LIMIT = 3;
const buckets = new Map<string, RateLimitBucket>();
const registrationBuckets = new Map<string, RateLimitBucket>();
const claimBuckets = new Map<string, RateLimitBucket>();

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

export function assertSourceRegistrationRateLimit(
  key: string,
  now = Date.now(),
): void {
  const bucketKey = key || "anonymous";
  const limitRaw = Number(process.env.TOLLGATE_REGISTRATION_CAP_PER_IP_PER_DAY);
  const limit =
    Number.isInteger(limitRaw) && limitRaw > 0 ? limitRaw : REGISTRATION_LIMIT;
  for (const [existingKey, bucket] of registrationBuckets) {
    if (now - bucket.windowStart >= REGISTRATION_WINDOW_MS) {
      registrationBuckets.delete(existingKey);
    }
  }
  const current = registrationBuckets.get(bucketKey);
  if (!current || now - current.windowStart >= REGISTRATION_WINDOW_MS) {
    registrationBuckets.set(bucketKey, { windowStart: now, count: 1 });
    return;
  }
  if (current.count >= limit) {
    throw new Error("Too many source registrations. Wait a day and retry.");
  }
  current.count += 1;
}

export function assertClaimRateLimit(key: string, now = Date.now()): void {
  const bucketKey = key || "anonymous";
  for (const [existingKey, bucket] of claimBuckets) {
    if (now - bucket.windowStart >= CLAIM_WINDOW_MS) {
      claimBuckets.delete(existingKey);
    }
  }
  const current = claimBuckets.get(bucketKey);
  if (!current || now - current.windowStart >= CLAIM_WINDOW_MS) {
    claimBuckets.set(bucketKey, { windowStart: now, count: 1 });
    return;
  }
  if (current.count >= CLAIM_LIMIT) {
    throw new Error("Too many claim attempts. Wait an hour and retry.");
  }
  current.count += 1;
}
