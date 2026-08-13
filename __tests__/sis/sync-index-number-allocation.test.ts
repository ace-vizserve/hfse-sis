/**
 * A new enrolment must not be handed an index_number the section has already
 * used — including one held by a WITHDRAWN student.
 *
 * WHY THIS EXISTS. `index_number` is a permanent per-section ID: teachers call
 * students by it, it is never re-sorted, and a withdrawn student's number is
 * greyed rather than reassigned. So a section can read "0 / 50 students" on
 * screen and still have #1 taken.
 *
 * `buildSyncPlan` appends at `max(index_number) + 1`, which is right when it
 * can see the whole section. A single-student sync cannot: it narrows
 * `enrollments` to that one student's rows on purpose, because every other
 * student in the year would otherwise look like a withdrawal. With that slice
 * the max came back 0, the next index was always 1, and on 2026-08-13
 * assigning TESTING SEVEN into Primary One / Respect — a section whose only
 * row was a withdrawn student at #1 — died on
 * `section_students_section_id_index_number_key`.
 *
 * The fix is `maxIndexBySection`, a section-wide ceiling the caller supplies
 * when its `enrollments` are not section-complete. These tests pin both halves:
 * the ceiling is honoured, and it never LOWERS a max that `enrollments`
 * already proves.
 */
import { describe, expect, it } from 'vitest';

import type { AdmissionsRow } from '@/lib/supabase/admissions';
import { buildSyncPlan, type GradingSnapshot } from '@/lib/sync/students';

const LEVEL = { id: 'lvl-p1', label: 'Primary One' };
const RESPECT = { id: 'sec-respect', level_id: 'lvl-p1', name: 'Respect' };

function row(overrides: Partial<AdmissionsRow> = {}): AdmissionsRow {
  return {
    student_number: 'H260535',
    last_name: 'TESTING SEVEN',
    first_name: 'TESTING SEVEN',
    middle_name: null,
    class_level: 'Primary One',
    class_section: 'Respect',
    class_ay: 'AY2026',
    enrolee_number: 'E260535',
    ...overrides,
  };
}

function snapshot(overrides: Partial<GradingSnapshot> = {}): GradingSnapshot {
  return {
    levels: [LEVEL],
    sections: [RESPECT],
    students: [],
    enrollments: [],
    ...overrides,
  };
}

describe('index_number allocation for a new enrolment', () => {
  it('appends after a withdrawn student the caller reported as the ceiling', () => {
    // The exact production shape: Respect holds one row, withdrawn, at #1.
    // It belongs to another student, so a single-student snapshot cannot see it.
    const plan = buildSyncPlan(
      [row()],
      snapshot({ maxIndexBySection: { 'sec-respect': 1 } })
    );

    expect(plan.errors).toEqual([]);
    expect(plan.enrollment_inserts).toHaveLength(1);
    expect(plan.enrollment_inserts[0].index_number).toBe(2);
  });

  it('still starts at 1 in a section that has genuinely never been used', () => {
    const plan = buildSyncPlan([row()], snapshot({ maxIndexBySection: {} }));

    expect(plan.enrollment_inserts[0].index_number).toBe(1);
  });

  it('takes the higher of the two when enrollments prove a bigger max', () => {
    // A stale or under-counted ceiling must never pull the number back down
    // onto a row the snapshot itself can see.
    const plan = buildSyncPlan(
      [row()],
      snapshot({
        maxIndexBySection: { 'sec-respect': 1 },
        enrollments: [
          {
            id: 'enr-9',
            section_id: 'sec-respect',
            student_id: 'stu-other',
            index_number: 9,
            enrollment_status: 'withdrawn',
          },
        ],
      })
    );

    expect(plan.enrollment_inserts[0].index_number).toBe(10);
  });

  it('keeps the old behaviour when no ceiling is supplied at all', () => {
    // The bulk sync passes a section-complete `enrollments` and no ceiling.
    const plan = buildSyncPlan(
      [row()],
      snapshot({
        enrollments: [
          {
            id: 'enr-1',
            section_id: 'sec-respect',
            student_id: 'stu-other',
            index_number: 4,
            enrollment_status: 'active',
          },
        ],
      })
    );

    expect(plan.enrollment_inserts[0].index_number).toBe(5);
  });

  it('gives two students in one run consecutive numbers above the ceiling', () => {
    const plan = buildSyncPlan(
      [row(), row({ student_number: 'H260536', enrolee_number: 'E260536' })],
      snapshot({ maxIndexBySection: { 'sec-respect': 1 } })
    );

    expect(plan.enrollment_inserts.map((e) => e.index_number)).toEqual([2, 3]);
  });
});
