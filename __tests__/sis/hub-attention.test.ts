import { describe, expect, it } from 'vitest';

import { buildAttentionRows } from '@/lib/sis/hub-attention';
import type { ClassAssignmentReadinessRow } from '@/lib/sis/dashboard';

function unplaced(
  overrides: Partial<ClassAssignmentReadinessRow> = {}
): ClassAssignmentReadinessRow {
  return {
    enroleeNumber: 'E-0001',
    fullName: 'Test Student',
    level: 'P3',
    enrollmentDate: '2026-01-05',
    daysSinceEnrollment: 3,
    ...overrides,
  };
}

describe('buildAttentionRows', () => {
  it('empty inputs produce an empty row list', () => {
    expect(
      buildAttentionRows({
        unassigned: [],
        pendingChangeRequests: 0,
      })
    ).toEqual([]);
  });

  it('unplaced students row is destructive and groups meta by level', () => {
    const rows = buildAttentionRows({
      unassigned: [
        unplaced({ level: 'P3' }),
        unplaced({ level: 'P3' }),
        unplaced({ level: 'S1' }),
      ],
      pendingChangeRequests: 0,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].severity).toBe('destructive');
    expect(rows[0].text).toContain('3 enrolled students have no class yet');
    expect(rows[0].meta).toContain('P3 ×2');
    expect(rows[0].meta).toContain('S1');
    expect(rows[0].href).toBe('/records/unsynced');
  });

  it('singular phrasing for exactly one unplaced student', () => {
    const rows = buildAttentionRows({
      unassigned: [unplaced()],
      pendingChangeRequests: 0,
    });
    expect(rows[0].text).toBe('1 enrolled student has no class yet');
  });

  it('pending change requests row only appears when count > 0', () => {
    const none = buildAttentionRows({
      unassigned: [],
      pendingChangeRequests: 0,
    });
    expect(none).toEqual([]);

    const some = buildAttentionRows({
      unassigned: [],
      pendingChangeRequests: 4,
    });
    expect(some).toHaveLength(1);
    expect(some[0].severity).toBe('amber');
    expect(some[0].text).toBe('4 grade changes are waiting on an approver');
    expect(some[0].href).toBe('/markbook/change-requests');
  });

  it('merges unplaced-student and pending-change-request signals in one list', () => {
    const rows = buildAttentionRows({
      unassigned: [unplaced()],
      pendingChangeRequests: 1,
    });
    expect(rows.map((r) => r.id)).toEqual([
      'unplaced-students',
      'pending-change-requests',
    ]);
  });
});

/** A named step with one person who approves for every child. */
const ONE_PERSON_STEP = {
  label: 'Ms Chandana',
  resolver: 'named' as const,
  approvers: [{ appliesToLevelType: null }] as Array<{
    appliesToLevelType: 'primary' | 'secondary' | 'preschool' | null;
  }>,
};

describe('buildAttentionRows — Phase 7 additions', () => {
  const BASE_INPUT = {
    unassigned: [],
    pendingChangeRequests: 0,
  };

  it('adds one destructive row for a section with no form adviser', () => {
    const rows = buildAttentionRows({
      ...BASE_INPUT,
      unassignedAdviserSections: [{ id: 'sec-1', name: 'S4 Excellence' }],
    });
    const row = rows.find((r) => r.id === 'unassigned-adviser-sections');
    expect(row).toMatchObject({
      severity: 'destructive',
      text: '1 section has no form adviser',
      meta: 'S4 Excellence',
    });
  });

  it('collapses multiple no-adviser sections into ONE row, not one per section', () => {
    const rows = buildAttentionRows({
      ...BASE_INPUT,
      unassignedAdviserSections: [
        { id: 'sec-1', name: 'P3 Obedience' },
        { id: 'sec-2', name: 'S1 Discipline' },
        { id: 'sec-3', name: 'S2 Integrity' },
      ],
    });
    const adviserRows = rows.filter((r) =>
      r.id.startsWith('unassigned-adviser')
    );
    expect(adviserRows).toHaveLength(1);
    expect(adviserRows[0]).toMatchObject({
      severity: 'destructive',
      text: '3 sections have no form adviser',
      meta: 'P3 Obedience · S1 Discipline · S2 Integrity',
    });
  });

  it('adds a destructive row when a grade-change approval has no steps', () => {
    const rows = buildAttentionRows({
      ...BASE_INPUT,
      approvalFlows: [
        {
          flow: 'markbook.grade_change_aeb',
          label: 'Grade changes after publishing',
          stages: [],
        },
      ],
    });
    const row = rows.find(
      (r) => r.id === 'approver-flow-markbook.grade_change_aeb'
    );
    expect(row).toMatchObject({
      severity: 'destructive',
      text: 'Grade changes after publishing: no steps set up',
      href: '/sis/admin/approvers',
    });
  });

  it('flags a step with nobody on it', () => {
    const rows = buildAttentionRows({
      ...BASE_INPUT,
      approvalFlows: [
        {
          flow: 'markbook.grade_change',
          label: 'Grade changes before publishing',
          stages: [{ ...ONE_PERSON_STEP, approvers: [] }],
        },
      ],
    });
    expect(
      rows.find((r) => r.id === 'approver-flow-markbook.grade_change')?.text
    ).toBe('Grade changes before publishing: 1 step has nobody in it');
  });

  it('omits the row when every step has somebody — one person is enough', () => {
    // ⚠ Not the retired pool's "at least 2 approvers" rule. A step is a
    // station, not a quorum.
    const rows = buildAttentionRows({
      ...BASE_INPUT,
      approvalFlows: [
        {
          flow: 'markbook.grade_change',
          label: 'Grade changes before publishing',
          stages: [ONE_PERSON_STEP],
        },
      ],
    });
    expect(rows.some((r) => r.id.startsWith('approver-flow-'))).toBe(false);
  });

  it('flags a half of the school nobody covers, keeping the half capitalised', () => {
    const rows = buildAttentionRows({
      ...BASE_INPUT,
      approvalFlows: [
        {
          flow: 'markbook.grade_change',
          label: 'Grade changes before publishing',
          stages: [
            {
              ...ONE_PERSON_STEP,
              approvers: [{ appliesToLevelType: 'primary' }],
            },
          ],
        },
      ],
      levelTypesInUse: ['primary', 'secondary'],
    });
    expect(
      rows.find((r) => r.id === 'approver-flow-markbook.grade_change')?.text
    ).toBe('Grade changes before publishing: nobody covers Secondary');
  });

  it('adds an amber row per level with no subjects configured', () => {
    const rows = buildAttentionRows({
      ...BASE_INPUT,
      subjectConfigGaps: [
        {
          levelId: 's1',
          levelLabel: 'Secondary 1',
        },
      ],
    });
    const row = rows.find((r) => r.id === 'subject-config-gap-s1');
    expect(row).toMatchObject({
      severity: 'amber',
      text: expect.stringContaining('Secondary 1'),
    });
  });

  it('omits all three new row types when their inputs are absent (backward compatible)', () => {
    const rows = buildAttentionRows(BASE_INPUT);
    expect(rows.some((r) => r.id.startsWith('unassigned-adviser-'))).toBe(
      false
    );
    expect(rows.some((r) => r.id.startsWith('approver-flow-'))).toBe(false);
    expect(rows.some((r) => r.id.startsWith('subject-config-gap-'))).toBe(
      false
    );
  });
});

describe('buildAttentionRows — severity-sorted (Serial Position Effect)', () => {
  it('sorts destructive rows before amber rows regardless of computation order', () => {
    // pendingChangeRequests (amber) is computed before unassignedAdviserSections
    // (destructive) in the function body — the sort must still put the
    // destructive row first in the returned array.
    const rows = buildAttentionRows({
      unassigned: [],
      pendingChangeRequests: 2,
      unassignedAdviserSections: [{ id: 'sec-1', name: 'P3 Obedience' }],
    });
    expect(rows.map((r) => r.severity)).toEqual(['destructive', 'amber']);
    expect(rows[0].id).toBe('unassigned-adviser-sections');
  });

  it('preserves relative order within the same severity (stable sort)', () => {
    const rows = buildAttentionRows({
      unassigned: [unplaced()],
      pendingChangeRequests: 1,
      approvalFlows: [
        {
          flow: 'markbook.grade_change',
          label: 'Grade changes before publishing',
          stages: [],
        },
      ],
    });
    // unplaced-students + approver-flow are both destructive, in that
    // computation order; pending-change-requests (amber) sorts after both.
    expect(rows.map((r) => r.id)).toEqual([
      'unplaced-students',
      'approver-flow-markbook.grade_change',
      'pending-change-requests',
    ]);
  });
});
