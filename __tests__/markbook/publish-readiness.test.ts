import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

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
}): SupabaseClient {
  return {
    from(table: string) {
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
