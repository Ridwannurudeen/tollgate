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
const RSS_IMPORT_WINDOW_MS = 60 * 60 * 1000;
const RSS_IMPORT_LIMIT = 10;
const DISCOVERY_WINDOW_MS = 60 * 60 * 1000;
const DISCOVERY_LIMIT = 10;
const WORDPRESS_REGISTRATION_WINDOW_MS = 24 * 60 * 60 * 1000;
const WORDPRESS_REGISTRATION_LIMIT = 20;
const WORDPRESS_PAY_WINDOW_MS = 60 * 1000;
const WORDPRESS_PAY_LIMIT = 30;
// Custodial demo pays real (testnet) USDC from a shared wallet per click, so it
// is capped both per-IP and globally.
const DEMO_PAID_QUERY_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEMO_PAID_QUERY_PER_IP_LIMIT = 2;
const DEMO_PAID_QUERY_GLOBAL_LIMIT = 30;
const buckets = new Map<string, RateLimitBucket>();
const registrationBuckets = new Map<string, RateLimitBucket>();
const claimBuckets = new Map<string, RateLimitBucket>();
const rssImportBuckets = new Map<string, RateLimitBucket>();
const discoveryBuckets = new Map<string, RateLimitBucket>();
const wordpressRegistrationBuckets = new Map<string, RateLimitBucket>();
const wordpressPayBuckets = new Map<string, RateLimitBucket>();
const demoPaidQueryBuckets = new Map<string, RateLimitBucket>();
let demoPaidQueryGlobal: RateLimitBucket = { windowStart: 0, count: 0 };

export function requestIp(headers: Headers): string {
  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded.split(",").map((part) => part.trim());
    const closestProxyValue = parts[parts.length - 1];
    if (closestProxyValue) return closestProxyValue;
  }
  return "local";
}

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

export function assertRssImportRateLimit(key: string, now = Date.now()): void {
  const bucketKey = key || "anonymous";
  for (const [existingKey, bucket] of rssImportBuckets) {
    if (now - bucket.windowStart >= RSS_IMPORT_WINDOW_MS) {
      rssImportBuckets.delete(existingKey);
    }
  }
  const current = rssImportBuckets.get(bucketKey);
  if (!current || now - current.windowStart >= RSS_IMPORT_WINDOW_MS) {
    rssImportBuckets.set(bucketKey, { windowStart: now, count: 1 });
    return;
  }
  if (current.count >= RSS_IMPORT_LIMIT) {
    throw new Error("Too many feed imports. Wait an hour and retry.");
  }
  current.count += 1;
}

export function assertDiscoveryRateLimit(key: string, now = Date.now()): void {
  const bucketKey = key || "anonymous";
  for (const [existingKey, bucket] of discoveryBuckets) {
    if (now - bucket.windowStart >= DISCOVERY_WINDOW_MS) {
      discoveryBuckets.delete(existingKey);
    }
  }
  const current = discoveryBuckets.get(bucketKey);
  if (!current || now - current.windowStart >= DISCOVERY_WINDOW_MS) {
    discoveryBuckets.set(bucketKey, { windowStart: now, count: 1 });
    return;
  }
  if (current.count >= DISCOVERY_LIMIT) {
    throw new Error(
      "Too many site discovery attempts. Wait an hour and retry.",
    );
  }
  current.count += 1;
}

export function assertWordPressRegistrationRateLimit(
  key: string,
  now = Date.now(),
): void {
  const bucketKey = key || "anonymous";
  for (const [existingKey, bucket] of wordpressRegistrationBuckets) {
    if (now - bucket.windowStart >= WORDPRESS_REGISTRATION_WINDOW_MS) {
      wordpressRegistrationBuckets.delete(existingKey);
    }
  }
  const current = wordpressRegistrationBuckets.get(bucketKey);
  if (
    !current ||
    now - current.windowStart >= WORDPRESS_REGISTRATION_WINDOW_MS
  ) {
    wordpressRegistrationBuckets.set(bucketKey, { windowStart: now, count: 1 });
    return;
  }
  if (current.count >= WORDPRESS_REGISTRATION_LIMIT) {
    throw new Error(
      "Too many WordPress site registrations. Wait a day and retry.",
    );
  }
  current.count += 1;
}

export function assertWordPressPayRateLimit(
  key: string,
  now = Date.now(),
): void {
  const bucketKey = key || "anonymous";
  for (const [existingKey, bucket] of wordpressPayBuckets) {
    if (now - bucket.windowStart >= WORDPRESS_PAY_WINDOW_MS) {
      wordpressPayBuckets.delete(existingKey);
    }
  }
  const current = wordpressPayBuckets.get(bucketKey);
  if (!current || now - current.windowStart >= WORDPRESS_PAY_WINDOW_MS) {
    wordpressPayBuckets.set(bucketKey, { windowStart: now, count: 1 });
    return;
  }
  if (current.count >= WORDPRESS_PAY_LIMIT) {
    throw new Error(
      "Too many WordPress payment attempts. Wait a minute and retry.",
    );
  }
  current.count += 1;
}

function activeCount(
  bucket: RateLimitBucket | undefined,
  now: number,
  windowMs: number,
): number {
  if (!bucket || now - bucket.windowStart >= windowMs) return 0;
  return bucket.count;
}

export function reserveDemoPaidQuery(
  key: string,
  now = Date.now(),
): { release: () => void } {
  const bucketKey = key || "anonymous";
  for (const [existingKey, bucket] of demoPaidQueryBuckets) {
    if (now - bucket.windowStart >= DEMO_PAID_QUERY_WINDOW_MS) {
      demoPaidQueryBuckets.delete(existingKey);
    }
  }
  if (
    activeCount(
      demoPaidQueryBuckets.get(bucketKey),
      now,
      DEMO_PAID_QUERY_WINDOW_MS,
    ) >= DEMO_PAID_QUERY_PER_IP_LIMIT
  ) {
    throw new Error(
      "Demo limit reached (2/day). Connect your own wallet to run more paid queries.",
    );
  }
  if (
    activeCount(demoPaidQueryGlobal, now, DEMO_PAID_QUERY_WINDOW_MS) >=
    DEMO_PAID_QUERY_GLOBAL_LIMIT
  ) {
    throw new Error(
      "The shared demo wallet's daily budget is used up. Try the free run, or connect your own wallet.",
    );
  }

  let ipBucket = demoPaidQueryBuckets.get(bucketKey);
  if (!ipBucket || now - ipBucket.windowStart >= DEMO_PAID_QUERY_WINDOW_MS) {
    ipBucket = { windowStart: now, count: 0 };
    demoPaidQueryBuckets.set(bucketKey, ipBucket);
  }
  if (now - demoPaidQueryGlobal.windowStart >= DEMO_PAID_QUERY_WINDOW_MS) {
    demoPaidQueryGlobal = { windowStart: now, count: 0 };
  }
  const globalBucket = demoPaidQueryGlobal;
  ipBucket.count += 1;
  globalBucket.count += 1;

  let released = false;
  return {
    release: () => {
      if (released) return;
      released = true;
      ipBucket.count -= 1;
      globalBucket.count -= 1;
      if (
        ipBucket.count === 0 &&
        demoPaidQueryBuckets.get(bucketKey) === ipBucket
      ) {
        demoPaidQueryBuckets.delete(bucketKey);
      }
      if (globalBucket.count === 0 && demoPaidQueryGlobal === globalBucket) {
        demoPaidQueryGlobal = { windowStart: 0, count: 0 };
      }
    },
  };
}
