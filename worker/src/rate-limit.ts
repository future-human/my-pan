/**
 * IP-based brute-force protection — global Map survives warm Worker instances.
 * No external dependencies (KV, D1, etc.).
 */

interface RateEntry {
  failures: number;
  firstFailure: number;
  blockedUntil: number;
}

const rateMap = new Map<string, RateEntry>();

const DELAY_THRESHOLD = 5;       // ≥ this: add artificial delay
const BLOCK_THRESHOLD = 10;      // ≥ this: block entirely
const BLOCK_DURATION = 15 * 60 * 1000; // 15 min
const WINDOW_MS = 60 * 60 * 1000;      // 1 hour — reset count after this
const MAX_ENTRIES = 10000;       // cap to prevent unbounded growth

let requestCount = 0;

function getClientIP(request: Request): string {
  // Cloudflare 注入的真实客户端 IP，Worker 内不受 X-Forwarded-For 欺骗
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

function cleanup() {
  const now = Date.now();
  for (const [ip, entry] of rateMap) {
    if (now > entry.blockedUntil && now - entry.firstFailure > WINDOW_MS) {
      rateMap.delete(ip);
    } else if (entry.blockedUntil === 0 && entry.failures === 0 && now - entry.firstFailure > WINDOW_MS) {
      rateMap.delete(ip);
    }
  }
}

/**
 * 检查该 IP 是否被限流或封锁。
 * 返回 { allowed, delayMs, error? }——
 *   allowed=false  → 请求应被拒绝（IP 封锁中）
 *   delayMs > 0    → 请求应有延迟（惩罚性减速）
 */
export function checkRateLimit(request: Request): { allowed: boolean; delayMs: number; retryAfter?: number; error?: string } {
  const ip = getClientIP(request);

  requestCount++;
  if (requestCount % 500 === 0) cleanup();

  const now = Date.now();
  let entry = rateMap.get(ip);

  if (!entry || now - entry.firstFailure > WINDOW_MS) {
    if (rateMap.size >= MAX_ENTRIES) cleanup();
    entry = { failures: 0, firstFailure: now, blockedUntil: 0 };
    rateMap.set(ip, entry);
  }

  // IP 封锁中
  if (entry.blockedUntil > 0 && now < entry.blockedUntil) {
    const remaining = Math.ceil((entry.blockedUntil - now) / 1000);
    return {
      allowed: false,
      delayMs: 0,
      retryAfter: remaining,
      error: `Too many attempts. Try again in ${remaining} seconds.`,
    };
  }

  // 封锁期已过，重置
  if (entry.blockedUntil > 0) {
    entry.blockedUntil = 0;
    entry.failures = 0;
  }

  // 递增延迟：2^(n-5) 秒，最长 30 秒
  if (entry.failures >= DELAY_THRESHOLD) {
    const delayMs = Math.min(Math.pow(2, entry.failures - DELAY_THRESHOLD) * 1000, 30000);
    return { allowed: true, delayMs };
  }

  return { allowed: true, delayMs: 0 };
}

/** 记录一次认证失败，递增计数器。超过阈值则封锁 IP。 */
export function recordAuthFailure(request: Request) {
  const ip = getClientIP(request);
  const entry = rateMap.get(ip);
  if (!entry) return;

  entry.failures++;
  if (entry.failures >= BLOCK_THRESHOLD) {
    entry.blockedUntil = Date.now() + BLOCK_DURATION;
  }
}

/** 认证成功后清除记录，恢复正常访问。 */
export function recordAuthSuccess(request: Request) {
  const ip = getClientIP(request);
  rateMap.delete(ip);
}
