// Where an attendance audit row's "Open section" action goes.
//
// Lived inside the attendance module's own copy of the audit table, which was
// the main reason that copy existed. It is resolved on the server now and set
// on the row, because the shared table is a client component and a
// `(row) => href` prop cannot cross that boundary.

type LinkableRow = {
  action: string;
  entity_id: string | null;
  context: Record<string, unknown>;
};

/**
 * The register for the section this entry touched, on the day it touched it.
 *
 * The date matters: an attendance correction is only legible next to the day
 * it corrected, so the link carries `?date=` when the context recorded one.
 */
export function attendanceAuditLink(
  row: LinkableRow
): { href: string; label: string } | null {
  const ctx = row.context;

  if (
    row.action === 'attendance.daily.update' ||
    row.action === 'attendance.daily.correct'
  ) {
    // entity_type === 'section'; entity_id is the section id.
    const sectionId =
      row.entity_id ?? (ctx['section_id'] as string | undefined);
    if (!sectionId) return null;
    const date = ctx['date'] as string | undefined;
    return {
      href: date
        ? `/attendance/${sectionId}?date=${date}`
        : `/attendance/${sectionId}`,
      label: 'Open section',
    };
  }

  if (row.action === 'attendance.import.bulk') {
    // ⚠ BOTH SPELLINGS. Bulk imports have been written with `section_id` and
    // with `sectionId` at different times, and dropping either silently loses
    // the link on those rows rather than failing visibly.
    const sectionId =
      row.entity_id ??
      (ctx['section_id'] as string | undefined) ??
      (ctx['sectionId'] as string | undefined);
    if (!sectionId) return null;
    return { href: `/attendance/${sectionId}`, label: 'Open section' };
  }

  return null;
}
