import { ApiError } from '@/lib/query/fetcher';

/**
 * Create invoice, Record payment and Send send one request id per submit, and
 * QuickBooks replays the original answer for a repeated id. A fresh id is
 * taken ONLY when our route answered with its own error (a JSON body with an
 * `error` field) — then nothing was written and the next submit is new —
 * unless that body also says `keepRequestId: true`: QuickBooks gave no
 * definite answer to the write, so it may have saved it. A lost response, a
 * network failure or a platform timeout (non-JSON body) also keeps the id, so
 * a retry of a write QuickBooks may have accepted is de-duplicated.
 */
export function shouldRenewRequestId(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  const body = err.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const b = body as Record<string, unknown>;
  return typeof b.error === 'string' && b.keepRequestId !== true;
}
