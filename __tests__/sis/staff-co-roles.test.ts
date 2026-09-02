import { describe, it, expect, vi, beforeEach } from 'vitest';

// The staff directory after migration 124.
//
// Two separate things are being pinned here, and they pull in opposite
// directions on purpose:
//
//   1. A co-adviser and a co-teacher appear on the staff row, because the
//      person really does hold the class. Leaving them off misreported what
//      somebody teaches, and made a co-teacher's own page look empty.
//   2. A teacher may advise MORE THAN ONE class. The unique index is one
//      adviser per SECTION; it says nothing about how many sections one
//      person may advise. The loader used to `.find()` the first row.

const mockGetTeacherList = vi.fn();
const mockFrom = vi.fn();

// `loadStaffAssignments` (the subject of this file) reads `getTeacherList`;
// `loadFormAdvisersBySection` in the same module reads `getAssignableStaffList`.
// Both must exist on the mock or the module import throws, even though only the
// first is exercised here.
vi.mock('@/lib/auth/staff-list', () => ({
  getTeacherList: (...args: unknown[]) => mockGetTeacherList(...args),
  getAssignableStaffList: (...args: unknown[]) => mockGetTeacherList(...args),
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({ from: mockFrom }),
}));

// unstable_cache wraps the loader; run straight through so the test exercises
// the real function rather than Next's cache shim.
vi.mock('next/cache', () => ({
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
}));

type Row = Record<string, unknown>;

const SECTIONS: Row[] = [
  { id: 'sec-diligence', name: 'Diligence', levels: { code: 'P4' } },
  { id: 'sec-humility', name: 'Humility', levels: { code: 'P2' } },
  { id: 'sec-excellence', name: 'Excellence', levels: { code: 'S4' } },
];

/**
 * The Supabase builder is thenable and chainable; every method returns `this`
 * and awaiting it resolves `{ data }`. Which table was asked for decides what
 * comes back.
 */
function stubClient(assignments: Row[]) {
  mockFrom.mockImplementation((table: string) => {
    const result =
      table === 'academic_years'
        ? { data: { id: 'ay-uuid' } }
        : table === 'sections'
          ? { data: SECTIONS }
          : { data: assignments };

    const builder: Record<string, unknown> = {
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve(result).then(resolve),
    };
    for (const m of ['select', 'eq', 'in', 'order', 'maybeSingle', 'single']) {
      builder[m] = () => builder;
    }
    return builder;
  });
}

function assignment(over: Row): Row {
  return {
    id: 'a-1',
    teacher_user_id: 'teacher-1',
    section_id: 'sec-diligence',
    subject_id: null,
    role: 'form_adviser',
    relief_teacher_user_id: null,
    subjects: null,
    ...over,
  };
}

async function load() {
  const { loadStaffAssignments } = await import('@/lib/sis/staff');
  return loadStaffAssignments('AY2026');
}

beforeEach(() => {
  vi.resetModules();
  mockFrom.mockReset();
  mockGetTeacherList.mockReset();
  mockGetTeacherList.mockResolvedValue([
    {
      id: 'teacher-1',
      email: 'elaine.wee@hfse.edu.sg',
      name: 'Elaine W.',
      disabled: false,
    },
  ]);
});

describe('a teacher who shares a class', () => {
  it('shows a co-adviser the class they co-advise', async () => {
    stubClient([
      assignment({
        id: 'a-co',
        section_id: 'sec-excellence',
        role: 'co_adviser',
      }),
    ]);
    const [row] = await load();

    expect(row.adviserSections).toHaveLength(1);
    expect(row.adviserSections[0]).toMatchObject({
      sectionName: 'Excellence',
      levelCode: 'S4',
      role: 'co_adviser',
    });
  });

  it('shows a co-teacher the subject they share', async () => {
    stubClient([
      assignment({
        id: 'a-co-sub',
        section_id: 'sec-humility',
        role: 'co_teacher',
        subject_id: 'sub-star',
        subjects: { code: 'STAR', name: 'STAR' },
      }),
    ]);
    const [row] = await load();

    expect(row.subjectAssignments).toHaveLength(1);
    expect(row.subjectAssignments[0]).toMatchObject({
      subjectCode: 'STAR',
      sectionName: 'Humility',
      role: 'co_teacher',
    });
  });

  it('keeps the two role families apart', async () => {
    // A co-adviser carries no subject and a co-teacher is not an adviser —
    // putting either in the wrong list is how a class gains a phantom subject.
    stubClient([
      assignment({
        id: 'a-1',
        role: 'co_adviser',
        section_id: 'sec-excellence',
      }),
      assignment({
        id: 'a-2',
        role: 'co_teacher',
        section_id: 'sec-humility',
        subject_id: 'sub-star',
        subjects: { code: 'STAR', name: 'STAR' },
      }),
    ]);
    const [row] = await load();

    expect(row.adviserSections.map((a) => a.role)).toEqual(['co_adviser']);
    expect(row.subjectAssignments.map((a) => a.role)).toEqual(['co_teacher']);
  });
});

describe('a teacher who advises more than one class', () => {
  it('shows every class, not the first one found', async () => {
    stubClient([
      assignment({
        id: 'a-1',
        section_id: 'sec-diligence',
        role: 'form_adviser',
      }),
      assignment({
        id: 'a-2',
        section_id: 'sec-humility',
        role: 'form_adviser',
      }),
    ]);
    const [row] = await load();

    expect(row.adviserSections).toHaveLength(2);
    expect(row.adviserSections.map((a) => a.sectionName).sort()).toEqual([
      'Diligence',
      'Humility',
    ]);
  });

  it('shows a class advised of record alongside one advised jointly', async () => {
    stubClient([
      assignment({
        id: 'a-1',
        section_id: 'sec-diligence',
        role: 'form_adviser',
      }),
      assignment({
        id: 'a-2',
        section_id: 'sec-excellence',
        role: 'co_adviser',
      }),
    ]);
    const [row] = await load();

    const byRole = Object.fromEntries(
      row.adviserSections.map((a) => [a.role, a.sectionName])
    );
    expect(byRole).toEqual({
      form_adviser: 'Diligence',
      co_adviser: 'Excellence',
    });
  });
});

describe('a section this year does not have', () => {
  it('is left out rather than rendered as a blank class', async () => {
    // Assignments are scoped to a year only through the section. A row whose
    // section belongs to another year has no name to show, and an empty chip
    // reads as a data bug rather than as "not this year".
    stubClient([assignment({ id: 'a-1', section_id: 'sec-from-last-year' })]);
    const [row] = await load();

    expect(row.adviserSections).toEqual([]);
  });
});
