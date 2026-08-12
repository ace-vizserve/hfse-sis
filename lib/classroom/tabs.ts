// Which sub-routes a given classroom capability may open. Pure — the tab nav
// (client) and every page's own belt-and-braces check both read from the
// same canReadAttendance / canReadWriteups predicates in lib/classroom/scope.ts,
// so this list can never drift from what those predicates actually allow.
//
// The load-bearing invariant of the whole Phase 4 feature: a 'subject'
// capability must never include 'attendance' or 'write-ups' — those are
// is_adviser_for_section at the RLS level (lib/classroom/scope.ts), and the
// data underneath is read via the service client, which bypasses RLS. If
// this list ever includes them for 'subject', the nav would offer a route
// whose page-level check then has to catch it — belt AND braces, not belt
// OR braces.

import {
  canReadAttendance,
  canReadRoster,
  canReadWriteups,
  type ClassroomCapability,
} from '@/lib/classroom/scope';

export type ClassroomTabKey =
  | 'overview'
  | 'grades'
  | 'students'
  | 'attendance'
  | 'write-ups'
  | 'timeline'
  | 'settings';

export type ClassroomTab = {
  key: ClassroomTabKey;
  label: string;
  /** Path segment under /classroom/[sectionId]; '' for the index route. */
  path:
    | ''
    | 'grades'
    | 'students'
    | 'attendance'
    | 'write-ups'
    | 'timeline'
    | 'settings';
};

const ALL_TABS: ClassroomTab[] = [
  { key: 'overview', label: 'Overview', path: '' },
  { key: 'grades', label: 'Grades', path: 'grades' },
  { key: 'students', label: 'Students', path: 'students' },
  { key: 'attendance', label: 'Attendance', path: 'attendance' },
  { key: 'write-ups', label: 'Write-ups', path: 'write-ups' },
  // Timeline is deliberately in the "any capability" bucket below, not
  // attendance/write-ups gated — it is a filtered view of audit_log, whose
  // rows are already scoped by which entity ids the query gathers, not by
  // RLS the way attendance_records / evaluation_writeups reads are. Phase 5
  // brief: "all capabilities may see it."
  { key: 'timeline', label: 'Timeline', path: 'timeline' },
  // Settings (Phase 6) is likewise "any capability may see it" — the
  // student-order preference is a display toggle and the note is scoped to
  // the CALLER's own row by RLS (migration 094), so there is nothing here a
  // subject-teacher viewer could see that they shouldn't.
  { key: 'settings', label: 'Settings', path: 'settings' },
];

/**
 * @param capability             what the viewer may DO here, cover included
 * @param substantiveCapability  what the viewer IS here, cover excluded
 *
 * Two arguments because the Write-ups tab and the Attendance tab stopped
 * having the same answer when relief teachers landed: a substitute takes the
 * attendance but the regular adviser still writes the write-ups. KD #173 —
 * the thing that LINKS to a page gates on what the page gates on — so this
 * must make the same distinction the write-ups page makes, or the tab renders
 * for a substitute and then 404s.
 *
 * Required rather than defaulted: a default of `capability` would silently
 * offer the tab to every substitute, which is the bug this exists to stop.
 */
export function tabsForCapability(
  capability: ClassroomCapability | null,
  substantiveCapability: ClassroomCapability | null
): ClassroomTab[] {
  return ALL_TABS.filter((tab) => {
    if (tab.key === 'attendance') return canReadAttendance(capability);
    if (tab.key === 'write-ups') return canReadWriteups(substantiveCapability);
    // Overview, Grades, Students, Timeline, Settings all just require the
    // roster-read floor — any capability at all (adviser / subject /
    // oversight).
    return canReadRoster(capability);
  });
}

/** Build the href for a tab, preserving the selected term. */
export function classroomTabHref(
  sectionId: string,
  tab: ClassroomTab,
  termId: string | null
): string {
  const base = `/classroom/${sectionId}${tab.path ? `/${tab.path}` : ''}`;
  return termId ? `${base}?term_id=${termId}` : base;
}
