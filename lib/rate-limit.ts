// Sliding-window in-memory rate limiter.
// Each warm serverless instance maintains its own counter — this gives
// per-instance throttling without any external dependency. For fleet-wide
// enforcement, swap `store` for an Upstash Redis client (@upstash/ratelimit).
import { NextResponse } from 'next/server';

type Entry = { count: number; resetAt: number };
const store = new Map<string, Entry>();

// Purge expired keys every minute so the Map doesn't grow unboundedly.
// `.unref()` prevents the interval from keeping a Node process alive in tests.
const timer = setInterval(() => {
  const now = Date.now();
  for (const [k, e] of store) if (e.resetAt < now) store.delete(k);
}, 60_000);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
if (typeof (timer as any).unref === 'function') (timer as any).unref();

export type RateLimitResult =
  | { limited: false }
  | { limited: true; retryAfter: number };

function checkLimit(
  key: string,
  max: number,
  windowSecs: number
): RateLimitResult {
  const now = Date.now();
  const e = store.get(key);
  if (!e || e.resetAt < now) {
    store.set(key, { count: 1, resetAt: now + windowSecs * 1000 });
    return { limited: false };
  }
  if (e.count >= max) {
    return { limited: true, retryAfter: Math.ceil((e.resetAt - now) / 1000) };
  }
  e.count += 1;
  return { limited: false };
}

/**
 * Check IP-based limit first, then optional per-user limit.
 * Call before any expensive work (DB queries, auth round-trips).
 */
export function rateLimit({
  ip,
  userId,
  scope,
  ipMax,
  userMax,
  windowSecs,
}: {
  ip: string;
  userId?: string;
  scope: string;
  ipMax: number;
  userMax?: number;
  windowSecs: number;
}): RateLimitResult {
  const ipResult = checkLimit(`${scope}:ip:${ip}`, ipMax, windowSecs);
  if (ipResult.limited) return ipResult;
  if (userId != null && userMax != null) {
    return checkLimit(`${scope}:user:${userId}`, userMax, windowSecs);
  }
  return { limited: false };
}

/**
 * The per-user limit on its own, for the second check after a token is
 * verified. ⚠ Not `rateLimit({ ip, userId, … })` there: that re-runs the IP
 * check, so every request was counted twice against the IP and a parent was
 * refused at half the stated limit.
 */
export function userRateLimit({
  userId,
  scope,
  userMax,
  windowSecs,
}: {
  userId: string;
  scope: string;
  userMax: number;
  windowSecs: number;
}): RateLimitResult {
  return checkLimit(`${scope}:user:${userId}`, userMax, windowSecs);
}

/** Extract caller IP from Vercel's x-forwarded-for header. */
export function getClientIp(request: {
  headers: { get(h: string): string | null };
}): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  );
}

/** Build a 429 response with Retry-After and optional extra headers (e.g. CORS). */
export function tooManyRequests(
  retryAfter: number,
  extraHeaders?: Record<string, string>
): NextResponse {
  return NextResponse.json(
    { error: 'Too many requests. Please try again shortly.' },
    {
      status: 429,
      headers: { 'Retry-After': String(retryAfter), ...extraHeaders },
    }
  );
}
