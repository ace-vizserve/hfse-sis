import { ApiError } from '@/lib/query/fetcher';

/**
 * Create invoice and Record payment send one request id per submit, and
 * QuickBooks replays the original answer for a repeated id. A fresh id is
 * taken ONLY when our route answered with its own error (a JSON body with an
 * `error` field) — then nothing was written and the next submit is new. A lost
 * response, a network failure or a platform timeout (non-JSON body) keeps the
 * id, so a retry of a write QuickBooks may have accepted is de-duplicated.
 */
export function shouldRenewRequestId(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  const body = err.body;
  return (
    !!body &&
    typeof body === 'object' &&
    !Array.isArray(body) &&
    typeof (body as Record<string, unknown>).error === 'string'
  );
}
