// The filter bar on every module's audit-log page: Action, Actor, date window.
//
// WHY THIS EXISTS. Seven pages render the same toolbar and each one wired it up
// by hand, so they drifted — and the drift was not cosmetic, it was that four of
// them did not work:
//
//   * admissions, p-files, records and SIS passed NO `actionOptions` or
//     `actorOptions` to the table at all. Both dropdowns rendered with nothing
//     in them but "All actions" / "All actors" — a filter you cannot use.
//   * those same four never read an `action` param, so even a hand-typed URL
//     was ignored.
//   * all seven filtered the DATE RANGE client-side over a server-PAGINATED
//     list, so picking a week kept only the rows of the page you happened to be
//     on and hid every match on the other pages. A real filter looked like an
//     empty log.
//
// One parser and one query-applier, so a page cannot wire up three of the four
// filters and look finished.

/**
 * The three PostgREST builder methods this needs, structurally.
 *
 * Typed this way rather than against `PostgrestFilterBuilder` so the helper
 * does not have to name supabase-js's generic parameters — which differ by
 * whether the query carries a count, and change between client versions.
 */
type Filterable = {
  eq(column: string, value: string): Filterable;
  gte(column: string, value: string): Filterable;
  lt(column: string, value: string): Filterable;
};

export type AuditFilterParams = {
  action?: string;
  actor?: string;
  from?: string;
  to?: string;
};

export type AuditFilters = {
  /** Validated against the module's allowlist; null if absent or unknown. */
  action: string | null;
  actor: string | null;
  /** ISO yyyy-mm-dd, as the picker writes them. */
  from: string | null;
  to: string | null;
};

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Read the four filters out of the URL.
 *
 * ⚠ `action` IS CHECKED AGAINST THE MODULE'S OWN ALLOWLIST, not merely
 * non-empty. The value reaches a PostgREST `eq`, and the allowlist is already
 * the list of actions this page is permitted to show — so validating against it
 * both blocks an injected filter and stops one module's page being used to read
 * another module's rows by hand-editing the query string.
 */
export function parseAuditFilters(
  params: AuditFilterParams,
  allowlist: readonly string[]
): AuditFilters {
  const action =
    params.action && (allowlist as readonly string[]).includes(params.action)
      ? params.action
      : null;

  const actor = params.actor?.trim() ? params.actor.trim() : null;

  // A malformed date is dropped rather than passed through. `new Date('week')`
  // is Invalid Date, and an invalid bound silently matches nothing, which would
  // read to the user as "there are no entries" instead of "that is not a date".
  const from = params.from && ISO_DAY.test(params.from) ? params.from : null;
  const to = params.to && ISO_DAY.test(params.to) ? params.to : null;

  // A backwards window returns nothing and looks like an empty log; swap it.
  if (from && to && from > to) return { action, actor, from: to, to: from };

  return { action, actor, from, to };
}

/**
 * Apply them to an `audit_log` query.
 *
 * ⚠ THE `to` BOUND COVERS THE WHOLE DAY. `created_at` is a timestamptz and the
 * picker hands back a date, so `lte('created_at', '2026-09-14')` means midnight
 * — it would exclude everything that happened ON the last day the user chose,
 * which is usually the day they care about most. `lt` of the NEXT midnight is
 * the honest reading of "up to and including the 14th".
 */
export function applyAuditFilters<T>(
  query: T,
  filters: AuditFilters,
  column = 'created_at'
): T {
  let q = query as unknown as Filterable;
  if (filters.action) q = q.eq('action', filters.action);
  if (filters.actor) q = q.eq('actor_email', filters.actor);
  if (filters.from) q = q.gte(column, `${filters.from}T00:00:00`);
  if (filters.to) {
    const next = new Date(`${filters.to}T00:00:00`);
    next.setDate(next.getDate() + 1);
    q = q.lt(column, next.toISOString());
  }
  return q as unknown as T;
}
