/**
 * IP-based brute-force protection — backed by Cloudflare KV.
 */

interface RateEntry {
  failures: number;
  firstFailure: number;
  blockedUntil: number;
}

const KV_PREFIX = 'rl:';

const DELAY_THRESHOLD = 5;
const BLOCK_THRESHOLD = 10;
const BLOCK_DURATION = 15 * 60 * 1000; // 15 min
const WINDOW_MS = 60 * 60 * 1000;      // 1 hour — reset count after this
const KV_TTL = Math.ceil(WINDOW_MS / 1000) + 60; // slightly over 1h for clock skew

function getClientIP(request: Request): string {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

function parseEntry(raw: string | null): RateEntry | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    if (typeof obj.failures === 'number' && typeof obj.firstFailure === 'number' && typeof obj.blockedUntil === 'number') {
      return obj;
    }
  } catch { /* ignore corrupt data */ }
  return null;
}

function makeKey(ip: string): string {
  return KV_PREFIX + ip;
}

/**
 * Check whether this request is rate-limited or blocked.
 * — allowed=false → reject with 429
 * — delayMs > 0   → apply artificial delay before processing
 */
export async function checkRateLimit(kv: KVNamespace, request: Request): Promise<{
  allowed: boolean; delayMs: number; retryAfter?: number; error?: string;
}> {
  const ip = getClientIP(request);
  const now = Date.now();

  const raw = await kv.get(makeKey(ip));
  let entry = parseEntry(raw);

  if (!entry || now - entry.firstFailure > WINDOW_MS) {
    entry = { failures: 0, firstFailure: now, blockedUntil: 0 };
  }

  // IP is blocked
  if (entry.blockedUntil > 0 && now < entry.blockedUntil) {
    const remaining = Math.ceil((entry.blockedUntil - now) / 1000);
    return {
      allowed: false,
      delayMs: 0,
      retryAfter: remaining,
      error: `Too many attempts. Try again in ${remaining} seconds.`,
    };
  }

  // Block expired, reset
  if (entry.blockedUntil > 0) {
    entry.blockedUntil = 0;
    entry.failures = 0;
  }

  // Persist current state
  await kv.put(makeKey(ip), JSON.stringify(entry), { expirationTtl: KV_TTL });

  // Exponential delay: 2^(n-5) sec, capped at 30s
  if (entry.failures >= DELAY_THRESHOLD) {
    const delayMs = Math.min(Math.pow(2, entry.failures - DELAY_THRESHOLD) * 1000, 30000);
    return { allowed: true, delayMs };
  }

  return { allowed: true, delayMs: 0 };
}

/** Record an auth failure. Increments counter; blocks IP if threshold exceeded. */
export async function recordAuthFailure(kv: KVNamespace, request: Request) {
  const ip = getClientIP(request);
  const now = Date.now();
  const raw = await kv.get(makeKey(ip));
  let entry = parseEntry(raw);

  if (!entry || now - entry.firstFailure > WINDOW_MS) {
    entry = { failures: 1, firstFailure: now, blockedUntil: 0 };
  } else {
    entry.failures++;
  }

  if (entry.failures >= BLOCK_THRESHOLD) {
    entry.blockedUntil = now + BLOCK_DURATION;
  }

  await kv.put(makeKey(ip), JSON.stringify(entry), { expirationTtl: KV_TTL });
}

/** Clear all rate-limiting state for this IP on successful auth. */
export async function recordAuthSuccess(kv: KVNamespace, request: Request) {
  const ip = getClientIP(request);
  await kv.delete(makeKey(ip));
}
