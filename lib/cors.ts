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
 *
 * ⚠ `methods` DEFAULTS TO READ-ONLY, and every caller that does not pass it
 * stays read-only. Parent declarations (2026-08-27) made this the first route
 * group the portal may write through, and the widening is deliberately opt-in
 * per route rather than a change to the shared default: the report-card and
 * students routes have no business advertising `POST`, and a default of
 * "everything" would hand it to them silently. `__tests__/api/cors-methods.test.ts`
 * pins that those two still advertise only `GET, OPTIONS`.
 *
 * Preflight matters now in a way it did not before — a JSON `POST` is not a
 * simple request, so the browser sends `OPTIONS` first on every write. Hence
 * `Access-Control-Max-Age`, which lets it cache the answer instead of asking
 * twice per submission.
 */
export function corsHeaders(
  origin: string | null,
  methods = 'GET, OPTIONS'
): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': methods,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
  if (origin && allowedOrigins.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'true';
  }
  return headers;
}
