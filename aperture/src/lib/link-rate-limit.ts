type RateLimitBucket = {
  windowStart: number;
  count: number;
};

const LINK_REGISTRATION_WINDOW_MS = 24 * 60 * 60 * 1000;
const LINK_REGISTRATION_LIMIT = 10;
const DEMO_UNLOCK_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEMO_UNLOCK_IP_LIMIT = 2;
const DEMO_UNLOCK_GLOBAL_LIMIT = 30;
const SESSION_LOGIN_WINDOW_MS = 60 * 1000;
const SESSION_LOGIN_LIMIT = 10;
const LOGIN_LINK_WINDOW_MS = 60 * 1000;
const LOGIN_LINK_LIMIT = 5;
const linkRegistrationBuckets = new Map<string, RateLimitBucket>();
const demoUnlockIpBuckets = new Map<string, RateLimitBucket>();
const sessionLoginBuckets = new Map<string, RateLimitBucket>();
const loginLinkBuckets = new Map<string, RateLimitBucket>();
let demoUnlockGlobalBucket: RateLimitBucket | null = null;

function pruneBuckets(
  buckets: Map<string, RateLimitBucket>,
  now: number,
  windowMs: number,
): void {
  for (const [existingKey, bucket] of buckets) {
    if (now - bucket.windowStart >= windowMs) {
      buckets.delete(existingKey);
    }
  }
}

function activeBucket(
  bucket: RateLimitBucket | undefined,
  now: number,
  windowMs: number,
): RateLimitBucket | null {
  if (!bucket || now - bucket.windowStart >= windowMs) return null;
  return bucket;
}

function recordBucket(
  buckets: Map<string, RateLimitBucket>,
  key: string,
  now: number,
  windowMs: number,
): void {
  const current = activeBucket(buckets.get(key), now, windowMs);
  if (!current) {
    buckets.set(key, { windowStart: now, count: 1 });
    return;
  }
  current.count += 1;
}

export function assertLinkRegistrationRateLimit(
  key: string,
  now = Date.now(),
): void {
  const bucketKey = key || "anonymous";
  pruneBuckets(linkRegistrationBuckets, now, LINK_REGISTRATION_WINDOW_MS);
  const current = linkRegistrationBuckets.get(bucketKey);
  if (!current || now - current.windowStart >= LINK_REGISTRATION_WINDOW_MS) {
    linkRegistrationBuckets.set(bucketKey, { windowStart: now, count: 1 });
    return;
  }
  if (current.count >= LINK_REGISTRATION_LIMIT) {
    throw new Error("Too many photo-link registrations. Wait a day and retry.");
  }
  current.count += 1;
}

export function assertDemoUnlockWithinLimits(
  key: string,
  now = Date.now(),
): void {
  const bucketKey = key || "anonymous";
  pruneBuckets(demoUnlockIpBuckets, now, DEMO_UNLOCK_WINDOW_MS);
  const ipBucket = activeBucket(
    demoUnlockIpBuckets.get(bucketKey),
    now,
    DEMO_UNLOCK_WINDOW_MS,
  );
  if (ipBucket && ipBucket.count >= DEMO_UNLOCK_IP_LIMIT) {
    throw new Error(
      "Free unlock limit reached (2/day). Use your own wallet to unlock more photos.",
    );
  }

  if (
    demoUnlockGlobalBucket &&
    now - demoUnlockGlobalBucket.windowStart >= DEMO_UNLOCK_WINDOW_MS
  ) {
    demoUnlockGlobalBucket = null;
  }
  if (
    demoUnlockGlobalBucket &&
    demoUnlockGlobalBucket.count >= DEMO_UNLOCK_GLOBAL_LIMIT
  ) {
    throw new Error(
      "The free-unlock daily budget is used up. Use your own wallet or try again tomorrow.",
    );
  }
}

export function recordDemoUnlock(key: string, now = Date.now()): void {
  const bucketKey = key || "anonymous";
  pruneBuckets(demoUnlockIpBuckets, now, DEMO_UNLOCK_WINDOW_MS);
  recordBucket(demoUnlockIpBuckets, bucketKey, now, DEMO_UNLOCK_WINDOW_MS);

  if (
    !demoUnlockGlobalBucket ||
    now - demoUnlockGlobalBucket.windowStart >= DEMO_UNLOCK_WINDOW_MS
  ) {
    demoUnlockGlobalBucket = { windowStart: now, count: 1 };
    return;
  }
  demoUnlockGlobalBucket.count += 1;
}

export function assertSessionLoginRateLimit(
  key: string,
  now = Date.now(),
): void {
  const bucketKey = key || "anonymous";
  pruneBuckets(sessionLoginBuckets, now, SESSION_LOGIN_WINDOW_MS);
  const current = sessionLoginBuckets.get(bucketKey);
  if (!current || now - current.windowStart >= SESSION_LOGIN_WINDOW_MS) {
    sessionLoginBuckets.set(bucketKey, { windowStart: now, count: 1 });
    return;
  }
  if (current.count >= SESSION_LOGIN_LIMIT) {
    throw new Error("Too many login attempts. Wait a minute and retry.");
  }
  current.count += 1;
}

export function assertLoginLinkRateLimit(key: string, now = Date.now()): void {
  const bucketKey = key || "anonymous";
  pruneBuckets(loginLinkBuckets, now, LOGIN_LINK_WINDOW_MS);
  const current = loginLinkBuckets.get(bucketKey);
  if (!current || now - current.windowStart >= LOGIN_LINK_WINDOW_MS) {
    loginLinkBuckets.set(bucketKey, { windowStart: now, count: 1 });
    return;
  }
  if (current.count >= LOGIN_LINK_LIMIT) {
    throw new Error("Too many login-link requests. Wait a minute and retry.");
  }
  current.count += 1;
}
