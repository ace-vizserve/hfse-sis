// Classroom Timeline — pure id-set logic for filtering `audit_log` down to
// one section, and only that. All I/O (the queries that produce the four id
// sources below, and the audit_log read itself) lives in
// lib/classroom/queries.ts; this module holds only the union/dedupe step, so
// it can be unit-tested without a database.
//
// The four sources — see the Phase 5 brief for why each is indexed and
// therefore safe to filter on:
//   1. the section id itself           → section.* actions
//   2. the section's grading_sheets ids → sheet.*, entry/totals updates
//   3. the section's section_students ids (every status, not just active —
//      a withdrawal or transfer is exactly the kind of history this page
//      exists to show) → enrolment.metadata.update and friends
//   4. the evaluation_writeups ids for this section's students → write-up
//      save/submit/resubmit
//
// Deliberately EXCLUDED from v1 — per-mark attendance. `attendance.daily.update`
// / `.correct` (app/api/attendance/daily/route.ts) log with `entityId: null`,
// putting `section_student_id` inside the unindexed `context` jsonb instead.
// That means (a) it cannot be reached via this indexed entity_id path, and
// (b) it writes roughly one row per student per school day — ~1,800 rows for
// a 30-student class in one term — which would drown every other event on
// this page. Do NOT "fix" this by adding a `context->>` filter; if a future
// phase wants attendance on the timeline, the right move is a
// per-submission summary row written at save time, not a jsonb scan here.
//
// Known gap (not fixed here, not this phase's scope): a few historical audit
// actions were logged with an entity_id that does not match any of the four
// categories above — e.g. `student.section.transfer` and the admissions-side
// withdrawal/re-enrolment cascade rows are logged against an `enroleeNumber`
// or an `entity_type: 'enrolment_status'` id, not a `section_students` row
// id. Those rows will not surface here even though they are section-shaped
// events; catching them would mean either a schema change to the audit
// writer (out of scope, "no schema change" per the brief) or a second,
// separately-scoped query, which the brief did not ask for.

export type TimelineEntitySources = {
  sectionId: string;
  sheetIds: string[];
  sectionStudentIds: string[];
  writeupIds: string[];
};

/**
 * Union + de-dupe the four id sources into one flat list for a single
 * `entity_id IN (...)` query against `audit_log`.
 */
export function gatherTimelineEntityIds(
  sources: TimelineEntitySources
): string[] {
  const ids = new Set<string>();
  ids.add(sources.sectionId);
  for (const id of sources.sheetIds) ids.add(id);
  for (const id of sources.sectionStudentIds) ids.add(id);
  for (const id of sources.writeupIds) ids.add(id);
  return Array.from(ids);
}

/** How many recent events the Timeline page shows — see its "most recent N"
 * copy, which reads directly from this constant so the two can't drift. */
export const TIMELINE_ROW_LIMIT = 50;
