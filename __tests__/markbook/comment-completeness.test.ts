import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  cumulativeCommentGaps,
  missingCommentStudents,
  type CumulativeTerm,
  type RosterStudent,
  type WriteupLite,
} from '@/lib/markbook/comment-completeness';

// ── Pure predicate ─────────────────────────────────────────────────────────

const ROSTER: RosterStudent[] = [
  {
    sectionStudentId: 'ss1',
    studentId: 'stu1',
    indexNumber: 1,
    name: 'A, A',
    enrollmentDate: null,
  },
  {
    sectionStudentId: 'ss2',
    studentId: 'stu2',
    indexNumber: 2,
    name: 'B, B',
    enrollmentDate: null,
  },
];

describe('missingCommentStudents', () => {
  it('flags students with no write-up row', () => {
    expect(missingCommentStudents(ROSTER, [])).toHaveLength(2);
  });

  it('flags a write-up that is not submitted', () => {
    const w: WriteupLite[] = [
      { student_id: 'stu1', writeup: 'Great term', submitted: false },
      { student_id: 'stu2', writeup: 'Solid', submitted: true },
    ];
    const missing = missingCommentStudents(ROSTER, w);
    expect(missing.map((m) => m.studentId)).toEqual(['stu1']);
  });

  it('flags a submitted-but-empty write-up', () => {
    const w: WriteupLite[] = [
      { student_id: 'stu1', writeup: '   ', submitted: true },
      { student_id: 'stu2', writeup: 'Solid', submitted: true },
    ];
    const missing = missingCommentStudents(ROSTER, w);
    expect(missing.map((m) => m.studentId)).toEqual(['stu1']);
  });

  it('passes when every student has a submitted non-empty write-up', () => {
    const w: WriteupLite[] = [
      { student_id: 'stu1', writeup: 'Great', submitted: true },
      { student_id: 'stu2', writeup: 'Solid', submitted: true },
    ];
    expect(missingCommentStudents(ROSTER, w)).toHaveLength(0);
  });

  it('always flags an orphaned roster row with no studentId', () => {
    const roster: RosterStudent[] = [
      {
        sectionStudentId: 'ss9',
        studentId: null,
        indexNumber: 9,
        name: '?',
        enrollmentDate: null,
      },
    ];
    expect(missingCommentStudents(roster, [])).toHaveLength(1);
  });
});

// ── Cumulative gate (with a stubbed service client) ────────────────────────

const TERMS: CumulativeTerm[] = [
  {
    id: 't1',
    term_number: 1,
    end_date: '2026-03-31',
    virtue_theme: 'Diligence',
  },
  { id: 't2', term_number: 2, end_date: '2026-06-30', virtue_theme: 'Respect' },
  {
    id: 't3',
    term_number: 3,
    end_date: '2026-09-30',
    virtue_theme: 'Integrity',
  },
  { id: 't4', term_number: 4, end_date: '2026-11-30', virtue_theme: null },
];

/**
 * Minimal chainable stub of the two query chains the helper uses:
 *   section_students  → .select().eq().in().order()  → roster rows
 *   evaluation_writeups → .select().eq().in()         → writeup rows (per term)
 *
 * `rosterRows` is the full active roster; `writeupsByTerm` maps termId → rows.
 */
function makeService(opts: {
  rosterRows: Array<{
    id: string;
    index_number: number | null;
    enrollment_status: string;
    enrollment_date?: string | null;
    student: { id: string; last_name: string; first_name: string } | null;
  }>;
  writeupsByTerm: Record<string, WriteupLite[]>;
}): SupabaseClient {
  return {
    from(table: string) {
      if (table === 'section_students') {
        const chain = {
          select: () => chain,
          eq: () => chain,
          in: () => chain,
          order: () => Promise.resolve({ data: opts.rosterRows, error: null }),
        };
        return chain;
      }
      if (table === 'evaluation_writeups') {
        let termId = '';
        const chain = {
          select: () => chain,
          eq: (_col: string, val: string) => {
            termId = val;
            return chain;
          },
          in: () =>
            Promise.resolve({
              data: opts.writeupsByTerm[termId] ?? [],
              error: null,
            }),
        };
        return chain;
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient;
}

// `cumulativeCommentGaps` is now GIVEN its roster rather than fetching one for
// itself — that second read discarded its error, and a failure made the
// report-card comment gate pass vacuously. Derived from the very rows the fake
// service returns so the two can never drift; mirrors `loadActiveRoster`.
type RosterRowFixture = {
  id: string;
  index_number: number;
  enrollment_date: string | null;
  student: { id: string; last_name: string; first_name: string };
};
const rosterArgFrom = (rows: RosterRowFixture[]): RosterStudent[] =>
  rows.map((r) => ({
    sectionStudentId: r.id,
    studentId: r.student.id,
    indexNumber: r.index_number,
    name: `${r.student.last_name}, ${r.student.first_name}`,
    enrollmentDate: r.enrollment_date,
  }));

const ROSTER_ROWS = [
  {
    id: 'ssA',
    index_number: 1,
    enrollment_status: 'active',
    enrollment_date: null,
    student: { id: 'A', last_name: 'A', first_name: 'A' },
  },
  {
    id: 'ssB',
    index_number: 2,
    enrollment_status: 'active',
    enrollment_date: null,
    student: { id: 'B', last_name: 'B', first_name: 'B' },
  },
];

const done = (id: string): WriteupLite => ({
  student_id: id,
  writeup: 'ok',
  submitted: true,
});

describe('cumulativeCommentGaps', () => {
  it('publishing T1 requires only T1 (ignores missing T2/T3)', async () => {
    const service = makeService({
      rosterRows: ROSTER_ROWS,
      writeupsByTerm: {
        t1: [done('A'), done('B')],
        // t2/t3 deliberately empty — must NOT be required for a T1 publish.
      },
    });
    const gaps = await cumulativeCommentGaps(
      service,
      'sec',
      TERMS,
      1,
      rosterArgFrom(ROSTER_ROWS)
    );
    expect(gaps).toHaveLength(0);
  });

  it('publishing T1 blocks when a T1 comment is missing', async () => {
    const service = makeService({
      rosterRows: ROSTER_ROWS,
      writeupsByTerm: { t1: [done('A')] }, // B missing
    });
    const gaps = await cumulativeCommentGaps(
      service,
      'sec',
      TERMS,
      1,
      rosterArgFrom(ROSTER_ROWS)
    );
    expect(gaps).toHaveLength(1);
    expect(gaps[0].termNumber).toBe(1);
    expect(gaps[0].missing.map((m) => m.studentId)).toEqual(['B']);
  });

  it('publishing T2 requires BOTH T1 and T2', async () => {
    const service = makeService({
      rosterRows: ROSTER_ROWS,
      writeupsByTerm: {
        t1: [done('A'), done('B')],
        t2: [done('A')], // B missing in T2
      },
    });
    const gaps = await cumulativeCommentGaps(
      service,
      'sec',
      TERMS,
      2,
      rosterArgFrom(ROSTER_ROWS)
    );
    expect(gaps.map((g) => g.termNumber)).toEqual([2]);
  });

  it('publishing T2 passes when T1 and T2 are both complete', async () => {
    const service = makeService({
      rosterRows: ROSTER_ROWS,
      writeupsByTerm: {
        t1: [done('A'), done('B')],
        t2: [done('A'), done('B')],
      },
    });
    expect(
      await cumulativeCommentGaps(
        service,
        'sec',
        TERMS,
        2,
        rosterArgFrom(ROSTER_ROWS)
      )
    ).toHaveLength(0);
  });

  it('a late enrollee (not on the active roster) is never required for any term', async () => {
    // Roster has only A + B. A student who joined later but isn't in the
    // active roster snapshot simply isn't counted — the gate is roster-driven.
    // Here we model "A joined in T2" by A having a T2 comment but the gate for
    // T1 still only checks the current active roster (A + B), and both have T1.
    const service = makeService({
      rosterRows: ROSTER_ROWS,
      writeupsByTerm: {
        t1: [done('A'), done('B')],
        t2: [done('A'), done('B')],
        t3: [done('A'), done('B')],
      },
    });
    expect(
      await cumulativeCommentGaps(
        service,
        'sec',
        TERMS,
        3,
        rosterArgFrom(ROSTER_ROWS)
      )
    ).toHaveLength(0);
  });

  // ── Per-term roster correctness (late-enrollee edge) ─────────────────────
  // A roster row whose enrollment_date is AFTER an earlier term's end_date
  // joined later and must NOT be required to have that earlier term's comment.
  // Under the OLD "current-roster-for-all-terms" logic these would FAIL.

  // C joined mid-T2 (after T1's end_date 2026-03-31). A + B always-enrolled.
  const ROSTER_WITH_T2_JOINER = [
    ...ROSTER_ROWS,
    {
      id: 'ssC',
      index_number: 3,
      enrollment_status: 'late_enrollee',
      enrollment_date: '2026-05-15', // within T2, after T1 ended
      student: { id: 'C', last_name: 'C', first_name: 'C' },
    },
  ];

  it('a T2 joiner does NOT block a T2 publish on a missing T1 comment', async () => {
    // T1: only A + B (C joined later, so T1 must not require C).
    // T2: all three present.
    const service = makeService({
      rosterRows: ROSTER_WITH_T2_JOINER,
      writeupsByTerm: {
        t1: [done('A'), done('B')], // C deliberately absent from T1
        t2: [done('A'), done('B'), done('C')],
      },
    });
    // Under the old logic C would be required for T1 → a T1 gap → fail.
    expect(
      await cumulativeCommentGaps(
        service,
        'sec',
        TERMS,
        2,
        rosterArgFrom(ROSTER_WITH_T2_JOINER)
      )
    ).toHaveLength(0);
  });

  it('a T2 joiner IS still required to have a T2 comment', async () => {
    const service = makeService({
      rosterRows: ROSTER_WITH_T2_JOINER,
      writeupsByTerm: {
        t1: [done('A'), done('B')],
        t2: [done('A'), done('B')], // C missing in T2 → must block T2
      },
    });
    const gaps = await cumulativeCommentGaps(
      service,
      'sec',
      TERMS,
      2,
      rosterArgFrom(ROSTER_WITH_T2_JOINER)
    );
    expect(gaps.map((g) => g.termNumber)).toEqual([2]);
    expect(gaps[0].missing.map((m) => m.studentId)).toEqual(['C']);
  });

  it('an always-enrolled (null date) student is required for every term', async () => {
    // B (null date) is missing T1 — must block even when C is a later joiner.
    const service = makeService({
      rosterRows: ROSTER_WITH_T2_JOINER,
      writeupsByTerm: {
        t1: [done('A')], // B missing in T1
        t2: [done('A'), done('B'), done('C')],
      },
    });
    const gaps = await cumulativeCommentGaps(
      service,
      'sec',
      TERMS,
      2,
      rosterArgFrom(ROSTER_WITH_T2_JOINER)
    );
    expect(gaps.map((g) => g.termNumber)).toEqual([1]);
    expect(gaps[0].missing.map((m) => m.studentId)).toEqual(['B']);
  });

  it('a student who joined after T3 is not required for T1/T2/T3', async () => {
    // D joined after T3's end_date (2026-09-30); publishing T3 must not require
    // D for any of T1/T2/T3 — they could not have written any of those.
    const rosterWithLateJoiner = [
      ...ROSTER_ROWS,
      {
        id: 'ssD',
        index_number: 4,
        enrollment_status: 'late_enrollee',
        enrollment_date: '2026-10-15', // after T3 ended
        student: { id: 'D', last_name: 'D', first_name: 'D' },
      },
    ];
    const service = makeService({
      rosterRows: rosterWithLateJoiner,
      writeupsByTerm: {
        t1: [done('A'), done('B')],
        t2: [done('A'), done('B')],
        t3: [done('A'), done('B')], // D absent everywhere — must still pass
      },
    });
    expect(
      await cumulativeCommentGaps(
        service,
        'sec',
        TERMS,
        3,
        rosterArgFrom(rosterWithLateJoiner)
      )
    ).toHaveLength(0);
  });

  it('a student who joined exactly on a term end_date is required for that term', async () => {
    // E joined on T1's end_date (2026-03-31) — `<=` boundary is inclusive, so
    // E IS required for T1.
    const rosterBoundary = [
      ...ROSTER_ROWS,
      {
        id: 'ssE',
        index_number: 3,
        enrollment_status: 'late_enrollee',
        enrollment_date: '2026-03-31', // == T1 end_date
        student: { id: 'E', last_name: 'E', first_name: 'E' },
      },
    ];
    const service = makeService({
      rosterRows: rosterBoundary,
      writeupsByTerm: {
        t1: [done('A'), done('B')], // E missing → must block T1
      },
    });
    const gaps = await cumulativeCommentGaps(
      service,
      'sec',
      TERMS,
      1,
      rosterArgFrom(rosterBoundary)
    );
    expect(gaps.map((g) => g.termNumber)).toEqual([1]);
    expect(gaps[0].missing.map((m) => m.studentId)).toEqual(['E']);
  });

  it('T4 is exempt — no comment gate even with everything missing', async () => {
    const service = makeService({
      rosterRows: ROSTER_ROWS,
      writeupsByTerm: {}, // nothing anywhere
    });
    expect(
      await cumulativeCommentGaps(
        service,
        'sec',
        TERMS,
        4,
        rosterArgFrom(ROSTER_ROWS)
      )
    ).toHaveLength(0);
  });

  // ── Virtue-theme gate ─────────────────────────────────────────────────────

  it('blocks when a displayed term has comments done but no virtue theme', async () => {
    const service = makeService({
      rosterRows: ROSTER_ROWS,
      writeupsByTerm: { t1: [done('A'), done('B')] },
    });
    const termsNoVirtue: CumulativeTerm[] = [
      { id: 't1', term_number: 1, end_date: '2026-03-31', virtue_theme: '   ' },
    ];
    const gaps = await cumulativeCommentGaps(
      service,
      'sec',
      termsNoVirtue,
      1,
      rosterArgFrom(ROSTER_ROWS)
    );
    expect(gaps).toHaveLength(1);
    expect(gaps[0].virtueMissing).toBe(true);
    expect(gaps[0].missing).toHaveLength(0);
  });

  it('reports both a comment gap and a virtue gap on the same term', async () => {
    const service = makeService({
      rosterRows: ROSTER_ROWS,
      writeupsByTerm: { t1: [done('A')] }, // B missing
    });
    const termsNoVirtue: CumulativeTerm[] = [
      { id: 't1', term_number: 1, end_date: '2026-03-31', virtue_theme: null },
    ];
    const gaps = await cumulativeCommentGaps(
      service,
      'sec',
      termsNoVirtue,
      1,
      rosterArgFrom(ROSTER_ROWS)
    );
    expect(gaps).toHaveLength(1);
    expect(gaps[0].virtueMissing).toBe(true);
    expect(gaps[0].missing.map((m) => m.studentId)).toEqual(['B']);
  });

  it('passes when comments are done and the virtue theme is set', async () => {
    const service = makeService({
      rosterRows: ROSTER_ROWS,
      writeupsByTerm: { t1: [done('A'), done('B')] },
    });
    expect(
      await cumulativeCommentGaps(
        service,
        'sec',
        TERMS,
        1,
        rosterArgFrom(ROSTER_ROWS)
      )
    ).toHaveLength(0);
  });
});
