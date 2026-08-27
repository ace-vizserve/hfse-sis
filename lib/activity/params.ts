import type { ActivityCursor, ActivityTab } from '@/lib/activity/feed';

// Pure query-string parsing for GET /api/activity, pulled out of the route
// handler so it can be unit-tested — Next.js route files should export only
// HTTP handlers.

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 50;

const TABS: ReadonlySet<string> = new Set([
  'general',
  'grade_change',
  'student_declaration',
]);

export type ParsedActivityParams = {
  tab: ActivityTab;
  limit: number;
  cursor: ActivityCursor;
};

export function parseActivityParams(
  params: URLSearchParams
): ParsedActivityParams {
  const rawTab = params.get('tab') ?? 'general';
  const tab: ActivityTab = TABS.has(rawTab)
    ? (rawTab as ActivityTab)
    : 'general';

  const rawLimit = Number(params.get('limit') ?? DEFAULT_LIMIT);
  // ⚠ The floor is 1, not 0. `rawLimit > 0` alone lets a value in (0, 1) — e.g.
  // 0.5 — through, and Math.trunc(0.5) is 0. A limit of 0 reaches pageEvents
  // as "return nothing", which comes back with nextCursor: null — the same
  // shape as "you've reached the end" — so a non-empty feed would silently
  // report itself finished. Math.max(..., 1) closes that gap.
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(Math.max(Math.trunc(rawLimit), 1), MAX_LIMIT)
      : DEFAULT_LIMIT;

  // The cursor round-trips as "<iso>|<id>" — two fields, one param, no JSON to
  // parse from a query string.
  let cursor: ActivityCursor = null;
  const rawCursor = params.get('cursor');
  if (rawCursor) {
    const [at, ...rest] = rawCursor.split('|');
    const id = rest.join('|');
    if (at && id) cursor = { at, id };
  }

  return { tab, limit, cursor };
}
