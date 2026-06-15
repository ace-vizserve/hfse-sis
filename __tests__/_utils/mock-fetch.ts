import { vi } from 'vitest';

/** Build a JSON `Response` (matches what `apiFetch` parses via content-type). */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Build a plain-text `Response`. */
export function textResponse(text: string, status = 200): Response {
  return new Response(text, {
    status,
    headers: { 'content-type': 'text/plain' },
  });
}

/**
 * Stub the global `fetch` with a custom implementation and return the spy so
 * tests can assert URL / method / signal. Pair with `vi.unstubAllGlobals()` in
 * an afterEach (or rely on Vitest's `unstubGlobals` config).
 */
export function stubFetch(
  impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
) {
  const fn = vi.fn(impl);
  vi.stubGlobal('fetch', fn);
  return fn;
}

/** Stub `fetch` to resolve the same response for every call. */
export function stubFetchOnce(response: Response) {
  return stubFetch(() => Promise.resolve(response));
}
