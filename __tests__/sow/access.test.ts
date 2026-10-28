import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Who can edit and read a scheme of work (Task 5 of the SOW module).
 *
 * Pinned:
 *   1. A substantive subject / co-teacher edits a draft or returned scheme.
 *   2. Nobody edits in review or once approved; relief cover only reads.
 *   3. Office roles and anyone on a step of the current request read.
 *   4. A teacher whose assignment is gone gets nothing.
 *   5. The "My schemes of work" rows group sections by subject x level
 *      (whatever their class type) and skip subjects the AY has not set up.
 */

const { loadMock } = vi.hoisted(() => ({ loadMock: vi.fn() }));
vi.mock('@/lib/auth/teacher-assignments', () => ({
  loadEffectiveAssignmentsForUser: (...args: unknown[]) => loadMock(...args),
}));

import type { EffectiveAssignmentRow } from '@/lib/auth/teacher-assignments';
import {
  isOnCurrentApprovalStep,
  listMySowRows,
  sowCapability,
  type SowState,
} from '@/lib/sow/access';

function assignment(
  over: Partial<EffectiveAssignmentRow> = {}
): EffectiveAssignmentRow {
  return {
    id: 'a1',
    teacher_user_id: 'u1',
    section_id: 's1',
    subject_id: 'math',
    role: 'subject_teacher',
    via: 'substantive',
    ...over,
  };
}

function cap(over: {
  role?: 'teacher' | 'academic_coordinator' | 'school_admin' | 'superadmin';
  assignments?: EffectiveAssignmentRow[];
  state?: SowState;
  onStep?: boolean;
}) {
  return sowCapability({
    role: over.role ?? 'teacher',
    userId: 'u1',
    assignments: over.assignments ?? [assignment()],
    sow: {
      subjectId: 'math',
      state: over.state ?? 'draft',
      classSectionIds: ['s1', 's2'],
    },
    isOnCurrentApprovalStep: over.onStep ?? false,
  });
}

describe('sowCapability', () => {
  it('a subject teacher on one class can edit a draft', () => {
    expect(cap({})).toBe('edit');
    expect(cap({ state: 'returned' })).toBe('edit');
  });

  it('a co-teacher can edit a draft', () => {
    expect(cap({ assignments: [assignment({ role: 'co_teacher' })] })).toBe(
      'edit'
    );
  });

  it('nobody edits while in review', () => {
    expect(cap({ state: 'in_review' })).toBe('read');
    expect(cap({ state: 'approved' })).toBe('read');
    expect(cap({ role: 'superadmin', state: 'in_review' })).toBe('read');
  });

  it('a relief teacher can read but not edit', () => {
    expect(
      cap({ assignments: [assignment({ via: 'relief' })], state: 'draft' })
    ).toBe('read');
  });

  it('a coordinator reads every SOW', () => {
    for (const role of [
      'academic_coordinator',
      'school_admin',
      'superadmin',
    ] as const) {
      expect(cap({ role, assignments: [], state: 'draft' })).toBe('read');
    }
  });

  it('a teacher whose assignment is gone can no longer edit', () => {
    expect(cap({ assignments: [] })).toBe('none');
  });

  it('a teacher of another subject or another class gets nothing', () => {
    expect(cap({ assignments: [assignment({ subject_id: 'science' })] })).toBe(
      'none'
    );
    expect(cap({ assignments: [assignment({ section_id: 's9' })] })).toBe(
      'none'
    );
  });

  it('a form adviser alone does not edit', () => {
    expect(
      cap({
        assignments: [assignment({ role: 'form_adviser', subject_id: null })],
      })
    ).toBe('none');
  });

  it('someone on a step of the current request reads', () => {
    expect(cap({ assignments: [], state: 'in_review', onStep: true })).toBe(
      'read'
    );
  });
});

type Tables = Record<string, Record<string, unknown>[]>;

function fakeService(tables: Tables): SupabaseClient {
  const from = (table: string) => {
    const rows = tables[table] ?? [];
    const chain: Record<string, unknown> = {};
    const result = { data: rows, error: null };
    for (const m of ['select', 'eq', 'in', 'order', 'contains', 'limit'])
      chain[m] = () => chain;
    chain.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
    chain.then = (res: (v: typeof result) => unknown) => res(result);
    return chain;
  };
  return { from } as unknown as SupabaseClient;
}

const baseTables = (): Tables => ({
  terms: [{ academic_year_id: 'ay' }],
  sections: [
    {
      id: 's1',
      name: 'P1 Patience',
      level_id: 'p1',
      class_type: 'Standard',
      academic_year_id: 'ay',
    },
    {
      id: 's2',
      name: 'P1 Courage',
      level_id: 'p1',
      // A Global class of the same level joins the same scheme (migration 200).
      class_type: 'Global',
      academic_year_id: 'ay',
    },
    {
      id: 's3',
      name: 'S1 Joy',
      level_id: 's1',
      class_type: 'Global',
      academic_year_id: 'ay',
    },
  ],
  subjects: [
    { id: 'math', name: 'Mathematics' },
    { id: 'art', name: 'Art' },
  ],
  levels: [
    { id: 'p1', label: 'Primary 1' },
    { id: 's1', label: 'Secondary 1' },
  ],
  subject_configs: [{ subject_id: 'math' }],
  subject_level_offerings: [
    { subject_id: 'math', level_id: 'p1' },
    { subject_id: 'math', level_id: 's1' },
  ],
  schemes_of_work: [],
});

describe('listMySowRows', () => {
  beforeEach(() => loadMock.mockReset());

  it('groups two sections of one level into one row, whatever their class type', async () => {
    loadMock.mockResolvedValue([
      assignment({ section_id: 's1' }),
      assignment({ id: 'a2', section_id: 's2' }),
      assignment({ id: 'a3', section_id: 's3', role: 'co_teacher' }),
    ]);
    const tables = baseTables();
    tables.schemes_of_work = [
      {
        id: 'w1',
        state: 'draft',
        subject_id: 'math',
        level_id: 'p1',
        scheme_of_work_classes: [{ section_id: 's1' }, { section_id: 's2' }],
      },
    ];
    const rows = await listMySowRows(fakeService(tables), 'u1', 'term');
    expect(rows).toHaveLength(2);
    expect(rows[0]).not.toHaveProperty('track');
    expect(rows[0]).toMatchObject({
      subjectName: 'Mathematics',
      levelLabel: 'Primary 1',
      classes: [
        { sectionId: 's2', name: 'P1 Courage' },
        { sectionId: 's1', name: 'P1 Patience' },
      ],
      sow: { id: 'w1', state: 'draft' },
    });
    expect(rows[1]).toMatchObject({ levelLabel: 'Secondary 1', sow: null });
  });

  it('shows the SOW classes, and flags my sections that are not on it', async () => {
    loadMock.mockResolvedValue([
      assignment({ section_id: 's1' }),
      assignment({ id: 'a2', section_id: 's2' }),
    ]);
    const tables = baseTables();
    tables.schemes_of_work = [
      {
        id: 'w1',
        state: 'draft',
        subject_id: 'math',
        level_id: 'p1',
        scheme_of_work_classes: [{ section_id: 's1' }, { section_id: 'sX' }],
      },
    ];
    tables.sections.push({
      id: 'sX',
      name: 'P1 Hope',
      level_id: 'p1',
      class_type: 'Standard',
      academic_year_id: 'ay',
    });
    const [row] = await listMySowRows(fakeService(tables), 'u1', 'term');
    expect(row.classes).toEqual([
      { sectionId: 'sX', name: 'P1 Hope' },
      { sectionId: 's1', name: 'P1 Patience' },
    ]);
    expect(row.myClassesNotOnSow).toEqual([
      { sectionId: 's2', name: 'P1 Courage' },
    ]);
  });

  it('a not-started row has my sections and nothing flagged', async () => {
    loadMock.mockResolvedValue([assignment({ section_id: 's1' })]);
    const [row] = await listMySowRows(fakeService(baseTables()), 'u1', 'term');
    expect(row.sow).toBeNull();
    expect(row.classes).toEqual([{ sectionId: 's1', name: 'P1 Patience' }]);
    expect(row.myClassesNotOnSow).toEqual([]);
  });

  it('skips a subject with no subject_configs row', async () => {
    loadMock.mockResolvedValue([
      assignment({ section_id: 's1' }),
      assignment({ id: 'a2', section_id: 's1', subject_id: 'art' }),
    ]);
    const tables = baseTables();
    tables.subject_level_offerings.push({ subject_id: 'art', level_id: 'p1' });
    const rows = await listMySowRows(fakeService(tables), 'u1', 'term');
    expect(rows.map((r) => r.subjectName)).toEqual(['Mathematics']);
  });

  it('ignores relief cover and form-adviser assignments', async () => {
    loadMock.mockResolvedValue([
      assignment({ via: 'relief' }),
      assignment({ id: 'a2', role: 'form_adviser', subject_id: null }),
    ]);
    const rows = await listMySowRows(fakeService(baseTables()), 'u1', 'term');
    expect(rows).toEqual([]);
  });
});

describe('isOnCurrentApprovalStep', () => {
  it('is true when a stage of the current request lists the user', async () => {
    const service = fakeService({
      approval_requests: [{ id: 'r1' }],
      approval_request_stages: [{ id: 'st1' }],
    });
    expect(await isOnCurrentApprovalStep(service, 'u1', 'sub1')).toBe(true);
  });

  it('is false when no stage lists the user, or there is no request', async () => {
    expect(
      await isOnCurrentApprovalStep(
        fakeService({
          approval_requests: [{ id: 'r1' }],
          approval_request_stages: [],
        }),
        'u1',
        'sub1'
      )
    ).toBe(false);
    expect(await isOnCurrentApprovalStep(fakeService({}), 'u1', 'sub1')).toBe(
      false
    );
    expect(await isOnCurrentApprovalStep(fakeService({}), 'u1', null)).toBe(
      false
    );
  });
});
