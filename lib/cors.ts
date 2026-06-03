// CORS for the cross-origin parent/admissions portal calling the SIS `/api`.
//
// The portal sends credentialed (cookie-bearing) requests, so the response must
// reflect the *exact* request Origin — `*` is disallowed with credentials — and
// set `Access-Control-Allow-Credentials: true`. Allowlist origins are compared
// exactly against the browser `Origin` header, which never carries a path or
// trailing slash; the env var is stripped defensively in case it's configured
// with one (a trailing slash was the bug behind staging being blocked).
const allowedOrigins = [
  process.env.ADMISSIONS_PORTAL_ORIGIN?.replace(/\/$/, ''),
  'http://localhost:5173',
  'https://online-admission-staging.vercel.app',
].filter((o): o is string => Boolean(o));

/**
 * CORS response headers for a parent-portal API call. Reflects `origin` when it
 * is in the allowlist (with credentials); otherwise omits the Allow-Origin
 * header so the browser blocks the disallowed caller. Spread into a Response's
 * `headers` (also passed to rate-limit error responses).
 */
export function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    Vary: 'Origin',
  };
  if (origin && allowedOrigins.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'true';
  }
  return headers;
}
