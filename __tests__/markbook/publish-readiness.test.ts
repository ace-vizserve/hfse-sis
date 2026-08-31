import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

// The T4 path calls getSchoolConfig() (constructs a real service client) —
// stub it with a complete letterhead so the T4 tests stay pure.
vi.mock('@/lib/sis/school-config', () => ({
  getSchoolConfig: async () => ({
    principalName: 'Principal',
    ceoName: 'CEO',
    peiRegistrationNumber: 'PEI-1',
  }),
}));

import {
  computePublishReadiness,
  type PublishReadiness,
} from '@/lib/markbook/publish-readiness';
import type { WriteupLite } from '@/lib/markbook/comment-completeness';

// ── Service stub ────────────────────────────────────────────────────────────
// The interim evaluator touches these query chains:
//   terms (single)        .from('terms').select().eq('id', termId).single()
//   section_students      .select().eq('section_id').in().order()  → roster
//   grading_sheets        .select().eq('section_id').eq('term_id')  → sheets
//   evaluation_writeups   .select().eq('term_id', X).in()           → writeups
//   attendance_records    .select().eq('term_id').in()              → attendance
//   terms (AY list)       .select().eq('academic_year_id').order()  → AY terms
//   section_students      (re-queried by cumulativeCommentGaps via loadActiveRoster)
//   evaluation_writeups   (re-queried per term by cumulativeCommentGaps)
//
// We deliberately stay OFF the T4 path (term_number !== 4) so getSchoolConfig()
// + grade_entries are never reached (those construct a real service client).

type TermRow = {
  id: string;
  term_number: number;
  academic_year_id: string;
  end_date: string | null;
  virtue_theme?: string | null;
};

type RosterRow = {
  id: string;
  index_number: number | null;
  enrollment_status: string;
  enrollment_date: string | null;
  student: { id: string; last_name: string; first_name: string } | null;
};

type SheetRow = {
  id: string;
  is_locked: boolean;
  subject: { id: string; name: string } | null;
};

type AttendanceRow = {
  section_student_id: string;
  school_days: number | null;
  days_present: number | null;
  days_late: number | null;
};

function makeService(opts: {
  termsById: Record<string, TermRow>;
  ayTerms: TermRow[]; // terms for the AY (cumulative gate)
  rosterRows: RosterRow[];
  sheetRows: SheetRow[];
  writeupsByTerm: Record<string, WriteupLite[]>;
  attendanceRows: AttendanceRow[];
  /** Whether the section has a form_adviser teacher_assignment. Default true. */
  hasFormAdviser?: boolean;
}): SupabaseClient {
  const hasFormAdviser = opts.hasFormAdviser ?? true;
  return {
    from(table: string) {
      if (table === 'teacher_assignments') {
        // .select('id').eq('section_id', X).eq('role', 'form_adviser').maybeSingle()
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: () =>
            Promise.resolve({
              data: hasFormAdviser ? { id: 'ta1' } : null,
              error: null,
            }),
        };
        return chain;
      }
      if (table === 'terms') {
        // Two shapes: .eq('id', X).single()  AND  .eq('academic_year_id', X).order()
        let col = '';
        let val = '';
        const chain = {
          select: () => chain,
          eq: (c: string, v: string) => {
            col = c;
            val = v;
            return chain;
          },
          order: () => {
            // AY-terms list query (academic_year_id filter)
            const rows = opts.ayTerms.filter((t) => t.academic_year_id === val);
            return Promise.resolve({ data: rows, error: null });
          },
          single: () => {
            if (col === 'id') {
              return Promise.resolve({
                data: opts.termsById[val] ?? null,
                error: null,
              });
            }
            return Promise.resolve({ data: null, error: null });
          },
        };
        return chain;
      }
      if (table === 'section_students') {
        const chain = {
          select: () => chain,
          eq: () => chain,
          in: () => chain,
          order: () => Promise.resolve({ data: opts.rosterRows, error: null }),
        };
        return chain;
      }
      if (table === 'grading_sheets') {
        // Interim path: .select().eq('section_id').eq('term_id') — the second
        // eq() resolves to the sheet rows.
        let eqCount = 0;
        const sheetChain = {
          select: () => sheetChain,
          eq: () => {
            eqCount += 1;
            if (eqCount >= 2) {
              return Promise.resolve({ data: opts.sheetRows, error: null });
            }
            return sheetChain;
          },
        };
        return sheetChain;
      }
      if (table === 'evaluation_writeups') {
        let termId = '';
        const chain = {
          select: () => chain,
          eq: (_c: string, v: string) => {
            termId = v;
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
      if (table === 'attendance_records') {
        const chain = {
          select: () => chain,
          eq: () => chain,
          in: () => Promise.resolve({ data: opts.attendanceRows, error: null }),
        };
        return chain;
      }
      // Per-year subject names (migration 137). No rows: none of these
      // fixtures renames a subject, which is the ordinary case — every name
      // then falls through to the catalogue name exactly as before, so the
      // existing expectations still describe the behaviour.
      if (table === 'subject_configs') {
        const chain = {
          select: () => chain,
          eq: () => Promise.resolve({ data: [], error: null }),
        };
        return chain;
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient;
}

// ── Fixtures ────────────────────────────────────────────────────────────────

const AY_TERMS: TermRow[] = [
  {
    id: 't1',
    term_number: 1,
    academic_year_id: 'ay',
    end_date: '2026-03-31',
    virtue_theme: 'Diligence',
  },
  {
    id: 't2',
    term_number: 2,
    academic_year_id: 'ay',
    end_date: '2026-06-30',
    virtue_theme: 'Respect',
  },
  {
    id: 't3',
    term_number: 3,
    academic_year_id: 'ay',
    end_date: '2026-09-30',
    virtue_theme: 'Integrity',
  },
];

const TERMS_BY_ID: Record<string, TermRow> = {
  t1: AY_TERMS[0],
  t2: AY_TERMS[1],
  t3: AY_TERMS[2],
};

const ROSTER_AB: RosterRow[] = [
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

const LOCKED_SHEET: SheetRow = {
  id: 'sh1',
  is_locked: true,
  subject: { id: 'subj1', name: 'Math' },
};
const UNLOCKED_SHEET: SheetRow = {
  id: 'sh2',
  is_locked: false,
  subject: { id: 'subj2', name: 'Science' },
};

const done = (id: string): WriteupLite => ({
  student_id: id,
  writeup: 'ok',
  submitted: true,
});

const fullAttendance = (ssId: string): AttendanceRow => ({
  section_student_id: ssId,
  school_days: 60,
  days_present: 58,
  days_late: 2,
});

function isReadiness(
  r: PublishReadiness | { error: string; status: number }
): r is PublishReadiness {
  return !('error' in r);
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('computePublishReadiness — verdict classification', () => {
  it('empty roster → hardBlockers includes no_students, canPublish false', async () => {
    const service = makeService({
      termsById: TERMS_BY_ID,
      ayTerms: AY_TERMS,
      rosterRows: [],
      sheetRows: [LOCKED_SHEET],
      writeupsByTerm: {},
      attendanceRows: [],
    });
    const r = await computePublishReadiness(service, 'sec', 't1');
    expect(isReadiness(r)).toBe(true);
    if (!isReadiness(r)) return;
    expect(r.hardBlockers.map((b) => b.code)).toContain('no_students');
    expect(r.canPublish).toBe(false);
  });

  it('no grading sheets → hardBlockers includes no_grading_sheets', async () => {
    const service = makeService({
      termsById: TERMS_BY_ID,
      ayTerms: AY_TERMS,
      rosterRows: ROSTER_AB,
      sheetRows: [],
      writeupsByTerm: { t1: [done('A'), done('B')] },
      attendanceRows: [fullAttendance('ssA'), fullAttendance('ssB')],
    });
    const r = await computePublishReadiness(service, 'sec', 't1');
    if (!isReadiness(r)) throw new Error('expected readiness');
    expect(r.hardBlockers.map((b) => b.code)).toContain('no_grading_sheets');
    expect(r.canPublish).toBe(false);
  });

  it('unlocked current-term sheet (roster + comments + attendance fine) → softGaps includes sheets_unlocked, canPublish true', async () => {
    const service = makeService({
      termsById: TERMS_BY_ID,
      ayTerms: AY_TERMS,
      rosterRows: ROSTER_AB,
      sheetRows: [LOCKED_SHEET, UNLOCKED_SHEET],
      writeupsByTerm: { t1: [done('A'), done('B')] },
      attendanceRows: [fullAttendance('ssA'), fullAttendance('ssB')],
    });
    const r = await computePublishReadiness(service, 'sec', 't1');
    if (!isReadiness(r)) throw new Error('expected readiness');
    expect(r.softGaps.map((g) => g.code)).toContain('sheets_unlocked');
    const unlocked = r.softGaps.find((g) => g.code === 'sheets_unlocked');
    expect(unlocked?.count).toBe(1);
    expect(r.hardBlockers).toHaveLength(0);
    expect(r.canPublish).toBe(true);
  });

  it('missing T1 comment when publishing T2 → comments_incomplete in hardBlockers', async () => {
    const service = makeService({
      termsById: TERMS_BY_ID,
      ayTerms: AY_TERMS,
      rosterRows: ROSTER_AB,
      sheetRows: [LOCKED_SHEET],
      writeupsByTerm: {
        t1: [done('A')], // B missing in T1
        t2: [done('A'), done('B')],
      },
      attendanceRows: [fullAttendance('ssA'), fullAttendance('ssB')],
    });
    const r = await computePublishReadiness(service, 'sec', 't2');
    if (!isReadiness(r)) throw new Error('expected readiness');
    expect(r.hardBlockers.map((b) => b.code)).toContain('comments_incomplete');
    expect(r.canPublish).toBe(false);
    // The comment_gate detail still reflects the cumulative gap (T1).
    expect(r.comment_gate.ok).toBe(false);
    expect(r.comment_gate.gaps.map((g) => g.term_number)).toContain(1);
  });

  it('fully complete interim → both lists empty, canPublish true', async () => {
    const service = makeService({
      termsById: TERMS_BY_ID,
      ayTerms: AY_TERMS,
      rosterRows: ROSTER_AB,
      sheetRows: [LOCKED_SHEET],
      writeupsByTerm: { t1: [done('A'), done('B')] },
      attendanceRows: [fullAttendance('ssA'), fullAttendance('ssB')],
    });
    const r = await computePublishReadiness(service, 'sec', 't1');
    if (!isReadiness(r)) throw new Error('expected readiness');
    expect(r.hardBlockers).toHaveLength(0);
    expect(r.softGaps).toHaveLength(0);
    expect(r.canPublish).toBe(true);
  });

  it('attendance incomplete → softGaps includes attendance_incomplete (still publishable)', async () => {
    const service = makeService({
      termsById: TERMS_BY_ID,
      ayTerms: AY_TERMS,
      rosterRows: ROSTER_AB,
      sheetRows: [LOCKED_SHEET],
      writeupsByTerm: { t1: [done('A'), done('B')] },
      attendanceRows: [fullAttendance('ssA')], // B has no attendance record
    });
    const r = await computePublishReadiness(service, 'sec', 't1');
    if (!isReadiness(r)) throw new Error('expected readiness');
    expect(r.softGaps.map((g) => g.code)).toContain('attendance_incomplete');
    expect(r.canPublish).toBe(true);
  });

  it('no form adviser assigned → hardBlockers includes no_form_adviser, canPublish false', async () => {
    const service = makeService({
      termsById: TERMS_BY_ID,
      ayTerms: AY_TERMS,
      rosterRows: ROSTER_AB,
      sheetRows: [LOCKED_SHEET],
      writeupsByTerm: { t1: [done('A'), done('B')] },
      attendanceRows: [fullAttendance('ssA'), fullAttendance('ssB')],
      hasFormAdviser: false,
    });
    const r = await computePublishReadiness(service, 'sec', 't1');
    if (!isReadiness(r)) throw new Error('expected readiness');
    expect(r.hardBlockers.map((b) => b.code)).toContain('no_form_adviser');
    expect(r.form_adviser.assigned).toBe(false);
    expect(r.canPublish).toBe(false);
  });

  it('form adviser assigned (default) → no no_form_adviser blocker', async () => {
    const service = makeService({
      termsById: TERMS_BY_ID,
      ayTerms: AY_TERMS,
      rosterRows: ROSTER_AB,
      sheetRows: [LOCKED_SHEET],
      writeupsByTerm: { t1: [done('A'), done('B')] },
      attendanceRows: [fullAttendance('ssA'), fullAttendance('ssB')],
    });
    const r = await computePublishReadiness(service, 'sec', 't1');
    if (!isReadiness(r)) throw new Error('expected readiness');
    expect(r.hardBlockers.map((b) => b.code)).not.toContain('no_form_adviser');
    expect(r.form_adviser.assigned).toBe(true);
  });

  it('missing term → returns { error, status: 404 }', async () => {
    const service = makeService({
      termsById: TERMS_BY_ID,
      ayTerms: AY_TERMS,
      rosterRows: ROSTER_AB,
      sheetRows: [LOCKED_SHEET],
      writeupsByTerm: {},
      attendanceRows: [],
    });
    const r = await computePublishReadiness(service, 'sec', 'nope');
    expect(isReadiness(r)).toBe(false);
    if (isReadiness(r)) return;
    expect(r.status).toBe(404);
  });
});

// ── T4 grades-missing scan — enrolment-coverage exemption (KD #148) ─────────
// A late enrollee's pre-join terms render N.A. on the report card at RENDER
// time (build-report-card.ts coverage logic) — never stored as is_na on any
// entry — so the T4 missing-grades scan must exempt them too.

type T4TermRow = TermRow & {
  start_date: string | null;
};

type AyEnrolmentRow = {
  id: string;
  student_id: string;
  enrollment_date: string | null;
  withdrawal_date: string | null;
};

type T4SheetRow = {
  id: string;
  term_id: string;
  is_locked: boolean;
  subject: { id: string; name: string; is_examinable: boolean } | null;
};

type T4EntryRow = {
  section_student_id: string;
  quarterly_grade: number | null;
  letter_grade: string | null;
  is_na: boolean;
  annual_letter_grade: string | null;
  grading_sheet: {
    id: string;
    term_id: string;
    subject: { id: string; name: string; is_examinable: boolean };
  };
};

function makeT4Service(opts: {
  t4Term: T4TermRow;
  ayTerms: T4TermRow[];
  rosterRows: RosterRow[];
  ayEnrolmentRows: AyEnrolmentRow[];
  allSheets: T4SheetRow[];
  entryRows: T4EntryRow[];
  attendanceRows: AttendanceRow[];
}): SupabaseClient {
  return {
    from(table: string) {
      if (table === 'teacher_assignments') {
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: () =>
            Promise.resolve({ data: { id: 'ta1' }, error: null }),
        };
        return chain;
      }
      if (table === 'terms') {
        let col = '';
        const chain = {
          select: () => chain,
          eq: (c: string) => {
            col = c;
            return chain;
          },
          order: () => Promise.resolve({ data: opts.ayTerms, error: null }),
          single: () =>
            Promise.resolve({
              data: col === 'id' ? opts.t4Term : null,
              error: null,
            }),
        };
        return chain;
      }
      if (table === 'section_students') {
        // Two shapes: the roster query ends with .order(); the AY-enrolments
        // query (.in('student_id').eq('section.academic_year_id')) is awaited
        // on the chain itself, so the chain is thenable.
        const chain = {
          select: () => chain,
          eq: () => chain,
          in: () => chain,
          order: () => Promise.resolve({ data: opts.rosterRows, error: null }),
          then: (
            resolve: (v: unknown) => unknown,
            reject: (e: unknown) => unknown
          ) =>
            Promise.resolve({ data: opts.ayEnrolmentRows, error: null }).then(
              resolve,
              reject
            ),
        };
        return chain;
      }
      if (table === 'grading_sheets') {
        // Current-term sheets: .eq('section_id').eq('term_id') (second eq
        // resolves). All-terms sheets: .eq('section_id').in('term_id', ids).
        let eqCount = 0;
        const chain = {
          select: () => chain,
          eq: () => {
            eqCount += 1;
            if (eqCount >= 2) {
              const t4Sheets = opts.allSheets.filter(
                (s) => s.term_id === opts.t4Term.id
              );
              return Promise.resolve({ data: t4Sheets, error: null });
            }
            return chain;
          },
          in: () => Promise.resolve({ data: opts.allSheets, error: null }),
        };
        return chain;
      }
      if (table === 'grade_entries') {
        // .select().in().in().range(from, to) — paginated via fetchAllPages.
        const chain = {
          select: () => chain,
          in: () => chain,
          range: (from: number, to: number) =>
            Promise.resolve({
              data: opts.entryRows.slice(from, to + 1),
              error: null,
            }),
        };
        return chain;
      }
      if (table === 'attendance_records') {
        const chain = {
          select: () => chain,
          eq: () => chain,
          in: () => Promise.resolve({ data: opts.attendanceRows, error: null }),
        };
        return chain;
      }
      // Per-year subject names (migration 137). No rows: none of these
      // fixtures renames a subject, which is the ordinary case — every name
      // then falls through to the catalogue name exactly as before, so the
      // existing expectations still describe the behaviour.
      if (table === 'subject_configs') {
        const chain = {
          select: () => chain,
          eq: () => Promise.resolve({ data: [], error: null }),
        };
        return chain;
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient;
}

const T4_AY_TERMS: T4TermRow[] = [
  {
    id: 't1',
    term_number: 1,
    academic_year_id: 'ay',
    start_date: '2026-01-05',
    end_date: '2026-03-31',
  },
  {
    id: 't2',
    term_number: 2,
    academic_year_id: 'ay',
    start_date: '2026-04-07',
    end_date: '2026-06-30',
  },
  {
    id: 't3',
    term_number: 3,
    academic_year_id: 'ay',
    start_date: '2026-07-07',
    end_date: '2026-09-30',
  },
  {
    id: 't4',
    term_number: 4,
    academic_year_id: 'ay',
    start_date: '2026-10-05',
    end_date: '2026-11-30',
  },
];

const MATH = { id: 'subj-math', name: 'Math', is_examinable: true };

const T4_SHEETS: T4SheetRow[] = T4_AY_TERMS.map((t) => ({
  id: `sh-${t.id}`,
  term_id: t.id,
  is_locked: true,
  subject: MATH,
}));

const entry = (
  ssId: string,
  termId: string,
  q: number | null,
  na = false
): T4EntryRow => ({
  section_student_id: ssId,
  quarterly_grade: q,
  letter_grade: null,
  is_na: na,
  annual_letter_grade: null,
  grading_sheet: { id: `sh-${termId}`, term_id: termId, subject: MATH },
});

describe('computePublishReadiness — T4 grades-missing scan (KD #148 coverage)', () => {
  it('late enrollee (joined T2): pre-join T1 is N.A.-exempt, a genuinely blank T3 still flags', async () => {
    const roster: RosterRow[] = [
      {
        id: 'ssL',
        index_number: 1,
        enrollment_status: 'late_enrollee',
        enrollment_date: '2026-05-01',
        student: { id: 'L', last_name: 'Late', first_name: 'Lee' },
      },
      {
        id: 'ssM',
        index_number: 2,
        enrollment_status: 'active',
        enrollment_date: null,
        student: { id: 'M', last_name: 'Main', first_name: 'May' },
      },
    ];
    const service = makeT4Service({
      t4Term: T4_AY_TERMS[3],
      ayTerms: T4_AY_TERMS,
      rosterRows: roster,
      ayEnrolmentRows: [
        {
          id: 'ssL',
          student_id: 'L',
          enrollment_date: '2026-05-01', // joined mid-T2
          withdrawal_date: null,
        },
        {
          id: 'ssM',
          student_id: 'M',
          enrollment_date: null,
          withdrawal_date: null,
        },
      ],
      allSheets: T4_SHEETS,
      entryRows: [
        // L: NO T1 entry at all (sheet predated the join — the KD #148 case
        // the stored-is_na exemption can never cover), T2/T4 graded, T3 blank
        // (a real gap that must still flag).
        entry('ssL', 't2', 80),
        entry('ssL', 't3', null),
        entry('ssL', 't4', 85),
        // M: fully graded — never flags.
        entry('ssM', 't1', 90),
        entry('ssM', 't2', 91),
        entry('ssM', 't3', 92),
        entry('ssM', 't4', 93),
      ],
      attendanceRows: [fullAttendance('ssL'), fullAttendance('ssM')],
    });

    const r = await computePublishReadiness(service, 'sec', 't4');
    if (!isReadiness(r)) throw new Error('expected readiness');

    // Exactly one gap row: L's Math, missing T3 only — T1 (pre-enrolment) is
    // exempt via coverage, NOT reported as missing.
    expect(r.t4_readiness?.missing_annual_count).toBe(1);
    expect(r.t4_readiness?.missing_annual_grades).toEqual([
      {
        student_name: 'Late, Lee',
        subject_name: 'Math',
        missing_terms: [3],
      },
    ]);

    // Classification stays SOFT (KD #139): grades_missing is a soft gap,
    // never a hard blocker; T4 has no comment gate.
    expect(r.softGaps.map((g) => g.code)).toContain('grades_missing');
    expect(r.hardBlockers).toHaveLength(0);
    expect(r.canPublish).toBe(true);
  });

  it('transfer: pre-transfer grades under the old (withdrawn) enrolment row still count via the student_id union', async () => {
    const roster: RosterRow[] = [
      {
        id: 'ssNew',
        index_number: 1,
        enrollment_status: 'active',
        enrollment_date: null,
        student: { id: 'X', last_name: 'Xfer', first_name: 'Xia' },
      },
    ];
    const service = makeT4Service({
      t4Term: T4_AY_TERMS[3],
      ayTerms: T4_AY_TERMS,
      rosterRows: roster,
      ayEnrolmentRows: [
        // KD #67 — the old row is withdrawn on transfer but its coverage
        // interval + grade entries still belong to the student.
        {
          id: 'ssOld',
          student_id: 'X',
          enrollment_date: null,
          withdrawal_date: '2026-06-15',
        },
        {
          id: 'ssNew',
          student_id: 'X',
          enrollment_date: '2026-06-16',
          withdrawal_date: null,
        },
      ],
      allSheets: T4_SHEETS,
      entryRows: [
        entry('ssOld', 't1', 88),
        entry('ssOld', 't2', 87),
        entry('ssNew', 't3', 90),
        entry('ssNew', 't4', 91),
      ],
      attendanceRows: [fullAttendance('ssNew')],
    });

    const r = await computePublishReadiness(service, 'sec', 't4');
    if (!isReadiness(r)) throw new Error('expected readiness');
    expect(r.t4_readiness?.missing_annual_count).toBe(0);
    expect(r.softGaps.map((g) => g.code)).not.toContain('grades_missing');
  });
});
