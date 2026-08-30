import { createClient as createSupabaseClient } from '@supabase/supabase-js';

// Service-role client for the grading DB.
// Use ONLY in API routes after verifying the caller's role via the
// cookie-bound server client. Bypasses RLS — never import from client code.

/**
 * Wraps the global `fetch` so every request the service client makes prints
 * one line: `[qtrace] <path> n=<running count> ms=<this request's elapsed>`.
 *
 * ONLY constructed when `QUERY_TRACE=1` — see `createServiceClient` below.
 * This is the Phase 0 real-app tracer (app-wide query/write pass): the audit
 * scripts and the counting-supabase test harness measure code paths in
 * isolation, but neither can see what a REAL page navigation or API request
 * actually issues end to end. Point `QUERY_TRACE=1 npm run dev` at a page and
 * the printed sequence is the ground truth the harness's numbers are meant to
 * predict.
 *
 * `n` counts requests made by THIS wrapped fetch instance (i.e. since this
 * particular `createServiceClient()` call), not a process-wide total — every
 * caller gets its own counter, so a request's `n` still shows "how many
 * queries has this one operation issued so far" even when several service
 * clients are alive at once (route handlers, `unstable_cache` loaders, etc.
 * each create their own).
 */
function tracingFetch(): typeof fetch {
  let count = 0;
  return async (input, init) => {
    count += 1;
    const started = Date.now();
    const res = await fetch(input, init);
    const ms = Date.now() - started;
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    let path = url;
    try {
      const parsed = new URL(url);
      path = parsed.pathname + parsed.search;
    } catch {
      // Not a parseable absolute URL — fall back to the raw string.
    }
    console.log(`[qtrace] ${path} n=${count} ms=${ms}`);
    return res;
  };
}

export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');
  }
  // The options argument stays an OBJECT LITERAL at the call site (a spread,
  // not a pre-typed intermediate variable) on purpose: assigning it to a
  // `Parameters<typeof createSupabaseClient>[2]`-typed variable first was
  // tried and changed which overload of `createClient` TypeScript resolves,
  // which silently widened `createServiceClient()`'s inferred return type
  // and broke unrelated callers in lib/change-requests/decide.ts and
  // lib/change-requests/sidebar-counts.ts. A literal (even with a
  // conditional spread inside it) keeps the exact contextual typing the
  // call had before this addition.
  //
  // Inert unless explicitly opted into — the code path below must be
  // byte-for-byte what shipped before this addition when the flag is unset.
  // Proven by __tests__/supabase/service-query-trace.test.ts.
  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    ...(process.env.QUERY_TRACE === '1'
      ? { global: { fetch: tracingFetch() } }
      : {}),
  });
}
