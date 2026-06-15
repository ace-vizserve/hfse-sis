/**
 * Single fetch chokepoint for all client-side API calls routed through
 * TanStack Query (KD #24 — TanStack Query is the client data standard).
 *
 * `apiFetch` throws a typed {@link ApiError} on a non-2xx response so the
 * error lands in `useQuery().isError` / `useMutation().onError`. The parsed
 * response body is carried on `ApiError.body`, so call-site error handlers can
 * read route-specific codes (e.g. 422 `comments_incomplete`, 409
 * `grading_lock_date_passed`) and show a precise toast — DO NOT flatten these
 * into a generic message.
 *
 * Pass `init.signal` through from a query's `queryFn` so reads abort on
 * unmount (this is what fixes the stale-response race the raw `useEffect`
 * fetches had).
 */

export class ApiError extends Error {
  readonly status: number;
  /** Parsed response body (JSON object/array, or string for non-JSON). */
  readonly body: unknown;

  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

/** Best-effort human message from a JSON error body (`error` / `message`). */
function messageFromBody(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const rec = body as Record<string, unknown>;
    if (typeof rec.error === 'string' && rec.error) return rec.error;
    if (typeof rec.message === 'string' && rec.message) return rec.message;
  }
  return fallback;
}

export async function apiFetch<T = unknown>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(input, init);

  const contentType = res.headers.get('content-type') ?? '';
  const isJson = contentType.includes('application/json');
  const body: unknown = isJson
    ? await res.json().catch(() => null)
    : await res.text().catch(() => '');

  if (!res.ok) {
    throw new ApiError(
      res.status,
      body,
      messageFromBody(body, res.statusText || `Request failed (${res.status})`)
    );
  }

  return body as T;
}

/**
 * Build a JSON-mutation `RequestInit`. Keeps the call sites terse and
 * consistent (`content-type: application/json` + serialized body) while still
 * allowing extra fields like `signal`. Extra init is spread first so `method`
 * / merged headers / `body` always win.
 */
export function jsonInit(
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  payload?: unknown,
  extra?: Omit<RequestInit, 'method' | 'body'>
): RequestInit {
  return {
    ...extra,
    method,
    headers: { 'content-type': 'application/json', ...(extra?.headers ?? {}) },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  };
}
