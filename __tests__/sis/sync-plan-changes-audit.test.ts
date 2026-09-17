import { describe, expect, it } from 'vitest';

import {
  buildSyncPlan,
  describeSyncPlanChanges,
  type GradingSnapshot,
} from '@/lib/sync/students';
import type { AdmissionsRow } from '@/lib/supabase/admissions';

// The bulk sync's audit row used to carry totals only. These pin that every
// student it touches is named, by student number, with what happened to them.

const snapshot: GradingSnapshot = {
  levels: [{ id: 'lvl-p1', label: 'Primary One' }],
  sections: [{ id: 'sec-a', level_id: 'lvl-p1', name: 'Patience' }],
  students: [
    {
      id: 'stu-1',
      student_number: 'S001',
      first_name: 'Ana',
      middle_name: null,
      last_name: 'Reyes',
    },
    {
      id: 'stu-2',
      student_number: 'S002',
      first_name: 'Ben',
      middle_name: null,
      last_name: 'Tan',
    },
  ],
  enrollments: [
    {
      id: 'enr-1',
      section_id: 'sec-a',
      student_id: 'stu-1',
      index_number: 1,
      enrollment_status: 'active',
    },
    {
      id: 'enr-2',
      section_id: 'sec-a',
      student_id: 'stu-2',
      index_number: 2,
      enrollment_status: 'withdrawn',
    },
  ],
};

function row(overrides: Partial<AdmissionsRow>): AdmissionsRow {
  return {
    student_number: null,
    last_name: null,
    first_name: null,
    middle_name: null,
    class_level: 'Primary One',
    class_section: 'Patience',
    class_ay: 'AY2026',
    enrolee_number: null,
    ...overrides,
  } as AdmissionsRow;
}

describe('describeSyncPlanChanges', () => {
  // S001 left the roster (withdrawn), S002 came back (reactivated) under a new
  // surname (renamed), S003 is brand new (added + enrolled at index 3).
  const rows = [
    row({ student_number: 'S002', first_name: 'Ben', last_name: 'Lim' }),
    row({
      student_number: 'S003',
      first_name: 'Cara',
      last_name: 'Ong',
      enrolee_number: 'E260003',
    }),
  ];
  const plan = buildSyncPlan(rows, snapshot);
  const changes = describeSyncPlanChanges(plan, snapshot);

  it('names every student the plan touches', () => {
    expect(
      changes.map((c) => `${c.student_number}:${c.change}`).sort()
    ).toEqual(
      [
        'S001:withdrawn',
        'S002:reactivated',
        'S002:renamed',
        'S003:added',
        'S003:enrolled',
      ].sort()
    );
  });

  it('carries class, index number and the old name', () => {
    expect(changes.find((c) => c.change === 'withdrawn')).toMatchObject({
      name: 'Ana Reyes',
      section: 'Patience',
      level: 'Primary One',
      index_number: 1,
      enrollment_id: 'enr-1',
      from: 'active',
      to: 'withdrawn',
    });
    expect(changes.find((c) => c.change === 'renamed')).toMatchObject({
      name: 'Ben Lim',
      name_before: 'Ben Tan',
    });
    expect(changes.find((c) => c.change === 'enrolled')).toMatchObject({
      name: 'Cara Ong',
      index_number: 3,
      section: 'Patience',
    });
  });
});
