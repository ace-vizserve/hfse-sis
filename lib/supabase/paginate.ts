// Supabase / PostgREST caps single-query responses at 1000 rows on the
// HFSE instance (the `db-max-rows` server setting). A query that returns
// more than 1000 rows comes back silently truncated — no error, no flag.
// At HFSE scale this hits attendance_daily (200 students × 61 dates =
// 12,200 rows for AY9999) and grade_entries fetches across all sections.
//
// `fetchAllPages` walks the result set with `.range()` until the server
// returns fewer than `pageSize` rows. The caller passes a builder factory
// because PostgREST query builders aren't reusable — each `.range()` call
// needs a fresh chain.

const DEFAULT_PAGE_SIZE = 1000;

export type PageBuilder<T> = (
  from: number,
  to: number,
) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

export async function fetchAllPages<T>(
  build: PageBuilder<T>,
  pageSize: number = DEFAULT_PAGE_SIZE,
): Promise<T[]> {
  const out: T[] = [];
  let page = 0;
  while (true) {
    const from = page * pageSize;
    const to = from + pageSize - 1;
    const { data, error } = await build(from, to);
    if (error) {
      throw new Error(`paginate fetch failed: ${error.message}`);
    }
    const batch = data ?? [];
    out.push(...batch);
    if (batch.length < pageSize) break;
    page += 1;
    // Defensive cap: prevent an unbounded loop if the page never shrinks
    // (would only happen with a broken server). 100 pages × 1000 rows =
    // 100K rows ceiling, well above any HFSE-scale dataset.
    if (page > 100) break;
  }
  return out;
}

// The GoTrue Admin API (`auth.admin.listUsers`) is a separate REST surface
// from PostgREST — page-based (`page`/`perPage`, 1-indexed), not
// `.range()`-based — but hits the same practical ceiling: every call site
// in this codebase historically hardcoded `perPage: 1000` and read page 1
// only, so a project whose user count crosses 1000 (this one has, between
// staff + parent-portal accounts sharing the project per KD #1) silently
// misses everyone past the first page. `listAllAuthUsers` walks every page
// until a page returns fewer than `perPage` rows.
import type { SupabaseClient, User } from '@supabase/supabase-js';

const AUTH_LIST_PAGE_SIZE = 1000;

export async function listAllAuthUsers(
  service: SupabaseClient,
): Promise<User[]> {
  const out: User[] = [];
  let page = 1;
  while (true) {
    const { data, error } = await service.auth.admin.listUsers({
      page,
      perPage: AUTH_LIST_PAGE_SIZE,
    });
    if (error) {
      throw new Error(`listAllAuthUsers failed: ${error.message}`);
    }
    const batch = data?.users ?? [];
    out.push(...batch);
    if (batch.length < AUTH_LIST_PAGE_SIZE) break;
    page += 1;
    // Defensive cap, same rationale as fetchAllPages above.
    if (page > 100) break;
  }
  return out;
}

// PostgREST passes `.in('col', [ids])` filters in the request URL query string.
// A large id list overflows the gateway's URL-length cap; depending on where it
// is cut off this surfaces either as a bare HTTP 400 "Bad Request" (before
// PostgREST can format a JSON error) or as a transport-level
// `TypeError: fetch failed`. `fetchInChunks` splits the id list into bounded
// batches, runs `fetchChunk` per batch, and concatenates the rows (order
// preserved). Mirrors the inline chunking already used in lib/markbook/drill.ts
// (ROLLUP_CHUNK) and lib/sis/environment.ts (IN_CHUNK).
//
// THE LIMIT IS URL BYTES, NOT ID COUNT. Measured against the live gateway on
// 2026-07-29: it fails past roughly 14.3KB of serialized filter — exactly 396
// UUIDs succeed and 397 fail. So the safe count depends entirely on id width:
//
//   uuid (36 chars + comma = 37B) ....... ~396 max   <- the dangerous case
//   enroleeNumber / student_number (~8B)  ~1,800 max <- ample headroom
//
// This matters because HFSE's active roster is ~405 students: any AY-wide array
// of student_id / section_student_id UUIDs is ALREADY over the line, while the
// same number of enroleeNumbers is nowhere near it. Two production bugs came
// from exactly this (see lib/evaluation/queries.ts::getWriteupProgressByTerm),
// and both were invisible because the caller discarded the PostgREST `error`
// and read the failure as "no rows" — a plausible zero instead of a crash.
//
// So: never put an unbounded UUID array in `.in()`. Either chunk it here, or —
// usually better when the filter isn't actually narrowing much — drop the
// filter, fetch via `fetchAllPages`, and intersect in JS. And never discard the
// error on a query that feeds a count.
//
// 200 uuids ~= 7.4KB, roughly half the ceiling: deliberately conservative so a
// caller whose ids are wider than a uuid still fits.
const DEFAULT_IN_CHUNK = 200;

export async function fetchInChunks<T>(
  ids: readonly string[],
  fetchChunk: (slice: string[]) => Promise<T[]>,
  chunkSize: number = DEFAULT_IN_CHUNK,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    const slice = ids.slice(i, i + chunkSize);
    out.push(...(await fetchChunk(slice)));
  }
  return out;
}
