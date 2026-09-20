// Where an attendance audit row's "Open section" action goes.
//
// Lived inside the attendance module's own copy of the audit table, which was
// the main reason that copy existed. It is resolved on the server now and set
// on the row, because the shared table is a client component and a
// `(row) => href` prop cannot cross that boundary.
//
// 🔴 `entity_id` IS NOT A SECTION ID, AND NEVER WAS. An earlier version of this
// file said "entity_type === 'section'; entity_id is the section id" and read
// `row.entity_id ?? ctx.section_id`. Checked against production on 2026-09-20:
// all three actions write `entity_type = 'attendance_daily'`, so `entity_id` is
// the attendance row's id. Preferring it built links like
//
//   /attendance/4f47abe3-3639-4f02-a731-2b7fff11fe5e?date=2026-09-17
//
// where the uuid is a mark, not a class. `/attendance/[sectionId]` matches that
// shape, loads nothing, and calls `notFound()` — so the link looked fine and
// went nowhere. 24 of the 46 links offered in a 300-row sample were this.
//
// The section id is only ever in the CONTEXT, and only on rows written after
// migration 166 added it — 139 of 200 `update` rows, 46 of 200 `correct`, and
// none of the bulk imports. Older rows simply cannot be linked.
//
// ⚠ NO LINK IS BETTER THAN A BROKEN ONE. When the context has no section, this
// returns null and the row renders without an action, rather than offering a
// button that dead-ends.

type LinkableRow = {
  action: string;
  entity_type?: string | null;
  entity_id: string | null;
  context: Record<string, unknown>;
};

/** A uuid, so a stray label or number can never be pasted into a URL. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The section id this row touched, from the only place that holds one.
 *
 * ⚠ BOTH SPELLINGS. Bulk imports have been written with `section_id` and with
 * `sectionId` at different times, and dropping either silently loses the link
 * on those rows rather than failing visibly.
 *
 * `entity_id` is consulted ONLY when the row says it is a section — no row does
 * today, but an entity_type is the one thing that would make it trustworthy, so
 * the check is written rather than the possibility assumed away.
 */
function sectionIdOf(row: LinkableRow): string | null {
  const ctx = row.context ?? {};
  const candidate =
    (row.entity_type === 'section' ? row.entity_id : null) ??
    (ctx['section_id'] as string | undefined) ??
    (ctx['sectionId'] as string | undefined) ??
    null;
  return candidate && UUID.test(candidate) ? candidate : null;
}

/**
 * The register for the section this entry touched, on the day it touched it.
 *
 * The date matters: an attendance correction is only legible next to the day
 * it corrected, so the link carries `?date=` when the context recorded one.
 */
export function attendanceAuditLink(
  row: LinkableRow
): { href: string; label: string } | null {
  const sectionId = sectionIdOf(row);
  if (!sectionId) return null;

  if (
    row.action === 'attendance.daily.update' ||
    row.action === 'attendance.daily.correct'
  ) {
    const date = row.context?.['date'] as string | undefined;
    // Only a plain YYYY-MM-DD reaches the query string.
    const safeDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
    return {
      href: safeDate
        ? `/attendance/${sectionId}?date=${safeDate}`
        : `/attendance/${sectionId}`,
      label: 'Open section',
    };
  }

  if (row.action === 'attendance.import.bulk') {
    return { href: `/attendance/${sectionId}`, label: 'Open section' };
  }

  return null;
}
