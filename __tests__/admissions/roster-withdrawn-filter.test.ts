/**
 * Tests for the `filterWithdrawnFromRoster` pure helper in
 * `lib/supabase/admissions.ts`.
 *
 * Context (Task 1 / KD #147): After the post-enrolment withdrawal fix, a
 * student who enrolled and then withdrew via Records keeps
 * applicationStatus='Enrolled' (the OUTCOME is append-only). Their current
 * withdrawal is signalled only by section_students.enrollment_status='withdrawn'.
 * Without the fix, `fetchAdmissionsRoster` would return them as an active
 * admissions row and `buildSyncPlan` would plan a reactivation — silently
 * undoing the registrar's withdrawal.
 *
 * `filterWithdrawnFromRoster` is the pure post-filter that removes such rows
 * so the sync planner never sees them.
 */
import { describe, expect, it } from 'vitest';
import {
  filterWithdrawnFromRoster,
  type AdmissionsRow,
} from '@/lib/supabase/admissions';

function makeRow(
  enroleeNumber: string | null,
  overrides: Partial<AdmissionsRow> = {}
): AdmissionsRow {
  return {
    student_number: 'S001',
    last_name: 'Cruz',
    first_name: 'Ana',
    middle_name: null,
    class_level: 'Primary One',
    class_section: 'Patience',
    class_ay: 'AY2026',
    enrolee_number: enroleeNumber,
    ...overrides,
  };
}

describe('filterWithdrawnFromRoster — sync reactivation guard', () => {
  it('returns the full roster when the withdrawn set is empty', () => {
    const roster = [makeRow('EN001'), makeRow('EN002')];
    const result = filterWithdrawnFromRoster(roster, new Set());
    expect(result).toHaveLength(2);
  });

  it('excludes a student whose enrolee_number is in the withdrawn set', () => {
    const roster = [makeRow('EN001'), makeRow('EN002'), makeRow('EN003')];
    const result = filterWithdrawnFromRoster(roster, new Set(['EN002']));
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.enrolee_number)).not.toContain('EN002');
    expect(result.map((r) => r.enrolee_number)).toContain('EN001');
    expect(result.map((r) => r.enrolee_number)).toContain('EN003');
  });

  it('excludes multiple withdrawn students', () => {
    const roster = [makeRow('EN001'), makeRow('EN002'), makeRow('EN003')];
    const result = filterWithdrawnFromRoster(
      roster,
      new Set(['EN001', 'EN003'])
    );
    expect(result).toHaveLength(1);
    expect(result[0].enrolee_number).toBe('EN002');
  });

  it('retains a row whose enrolee_number is null (unknown — cannot cross-ref)', () => {
    const roster = [makeRow(null), makeRow('EN001')];
    const result = filterWithdrawnFromRoster(roster, new Set(['EN001']));
    expect(result).toHaveLength(1);
    // The null-enrolee row is retained (cannot be excluded by enroleeNumber)
    expect(result[0].enrolee_number).toBeNull();
  });

  it('returns an empty array when the entire roster is withdrawn', () => {
    const roster = [makeRow('EN001'), makeRow('EN002')];
    const result = filterWithdrawnFromRoster(
      roster,
      new Set(['EN001', 'EN002'])
    );
    expect(result).toHaveLength(0);
  });

  // The critical scenario: enrolled-then-withdrawn student scenario.
  // applicationStatus='Enrolled' (outcome preserved) + enrollment_status='withdrawn'
  // (current state). The roster built from admissions tables includes them;
  // filterWithdrawnFromRoster must exclude them so the sync never reactivates.
  it('CRITICAL — enrolled-then-withdrawn student is excluded from the sync roster', () => {
    const enrolledThenWithdrawn = makeRow('EN-WD', {
      student_number: 'STU-WD',
      class_section: 'Obedience', // section was assigned (applicationStatus='Enrolled')
    });
    const activeStudent = makeRow('EN-ACT', {
      student_number: 'STU-ACT',
      class_section: 'Patience',
    });

    const roster = [enrolledThenWithdrawn, activeStudent];
    // Simulate: section_students query returned EN-WD as enrollment_status='withdrawn'
    const withdrawnSet = new Set(['EN-WD']);

    const result = filterWithdrawnFromRoster(roster, withdrawnSet);
    expect(result).toHaveLength(1);
    expect(result[0].enrolee_number).toBe('EN-ACT');
    expect(result.some((r) => r.enrolee_number === 'EN-WD')).toBe(false);
  });
});
