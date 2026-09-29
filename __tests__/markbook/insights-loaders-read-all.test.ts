/**
 * One school year holds ~1,116 grading sheets. PostgREST returns at most 1,000
 * rows per request, with no error. Three Insights reads asked once and never
 * paged, so the figures they fed counted a subset. This file gives each read
 * 1,200 sheets and checks that every one is counted.
 */
import { describe, expect, it, vi } from 'vitest';

import { makeFakeService, type Tables } from './_support/fake-service';

let TABLES: Tables = {};

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => makeFakeService(TABLES),
}));
vi.mock('next/cache', () => ({
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
  revalidateTag: () => undefined,
}));
vi.mock('@/lib/auth/teacher-emails', () => ({
  getTeacherEmailMap: async () => [],
}));
vi.mock('@/lib/auth/staff-list', () => ({
  getStaffDisplayNameById: async () => [],
}));
vi.mock('@/lib/dashboard/ay-id', () => ({
  getAyIdByCode: async (code: string) => (code === 'AY2026' ? 'ay26' : null),
}));

import type { CompareCellResult } from '@/lib/dashboard/compare';
import {
  getSubjectLevelTrend,
  getSubjectPerformanceTrend,
  type MarkbookCompareKpis,
} from '@/lib/markbook/compare';
import { getSheetLockProgressByTerm } from '@/lib/markbook/dashboard';
import {
  buildMarkbookDrillRows,
  type ChangeRequestRow,
} from '@/lib/markbook/drill';

const SHEETS = 1200;

function bigYear(): Tables {
  const sheets = Array.from({ length: SHEETS }, (_, i) => {
    const english = i >= 1000;
    return {
      id: `sh-${String(i).padStart(4, '0')}`,
      term_id: 't26-1',
      section_id: 'sec-a',
      subject_id: english ? 'sub-eng' : 'sub-math',
      qa_total: 30,
      is_locked: i < 700,
      locked_at: i < 700 ? '2026-03-01T00:00:00Z' : null,
      teacher_name: null,
      subject: {
        name: english ? 'English' : 'Mathematics',
        is_examinable: true,
      },
      section: { level: { code: 'P1' } },
    };
  });
  return {
    academic_years: [{ id: 'ay26', ay_code: 'AY2026' }],
    terms: [
      {
        id: 't26-1',
        term_number: 1,
        academic_year_id: 'ay26',
        label: 'Term 1',
        start_date: '2026-01-05',
        end_date: '2026-03-13',
        is_current: true,
      },
    ],
    sections: [
      {
        id: 'sec-a',
        name: 'Patience',
        academic_year_id: 'ay26',
        level_id: 'lv-p1',
      },
    ],
    levels: [{ id: 'lv-p1', code: 'P1' }],
    subjects: [
      {
        id: 'sub-math',
        code: 'MATH',
        name: 'Mathematics',
        is_examinable: true,
      },
      { id: 'sub-eng', code: 'ENG', name: 'English', is_examinable: true },
    ],
    subject_configs: [],
    grading_sheets: sheets,
    grade_entries: sheets.map((s, i) => ({
      id: `ge-${s.id}`,
      grading_sheet_id: s.id,
      section_student_id: 'ss-1',
      ww_scores: [8],
      pt_scores: [9],
      qa_score: 25,
      quarterly_grade: i >= 1000 ? 90 : 80,
      letter_grade: null,
      is_na: false,
      created_at: '2026-02-01T00:00:00Z',
    })),
    grade_change_requests: [
      {
        id: 'cr-late',
        grading_sheet_id: 'sh-1150',
        field_changed: 'ww_scores',
        reason_category: 'data_entry_error',
        status: 'pending',
        requested_by_email: 't@hfse.test',
        requested_at: '2026-09-20T00:00:00Z',
        reviewed_at: null,
        applied_at: null,
        grading_sheets: { sections: { academic_year_id: 'ay26' } },
      },
    ],
    teacher_assignments: [],
    section_students: [
      {
        id: 'ss-1',
        section_id: 'sec-a',
        student_id: 'st-1',
        enrollment_status: 'active',
      },
    ],
    students: [
      {
        id: 'st-1',
        student_number: 'H260001',
        first_name: 'Ana',
        last_name: 'Reyes',
      },
    ],
    report_card_publications: [],
  };
}

const T1_CELL = [
  {
    cell: {
      ayCode: 'AY2026',
      label: 'AY2026 · T1',
      kind: 'term',
      termNumber: 1,
      termId: 't26-1',
      range: { from: '2026-01-05', to: '2026-03-13' },
    },
    data: null,
  },
] as unknown as CompareCellResult<MarkbookCompareKpis>[];

describe('Insights loaders read past 1,000 sheets', () => {
  it('sheets locked per term counts all 1,200 sheets', async () => {
    TABLES = bigYear();
    expect(await getSheetLockProgressByTerm('ay26', 'AY2026')).toEqual([
      { termNumber: 1, termLabel: 'Term 1', locked: 700, open: 500 },
    ]);
  });

  it('the subject trend sees the sheets past the first 1,000', async () => {
    TABLES = bigYear();
    const points = await getSubjectPerformanceTrend(T1_CELL);
    expect(points.find((p) => p.subjectName === 'English')?.avgGrade).toBe(90);
    expect(points.find((p) => p.subjectName === 'Mathematics')?.avgGrade).toBe(
      80
    );
  });

  it('the subject × level trend sees them too', async () => {
    TABLES = bigYear();
    const raw = await getSubjectLevelTrend(T1_CELL);
    expect(raw.find((p) => p.subjectName === 'English')?.count).toBe(200);
  });

  it('the change-request drill sees a request on sheet #1,150', async () => {
    TABLES = bigYear();
    const rows = (await buildMarkbookDrillRows({
      ayCode: 'AY2026',
      target: 'change-requests',
    })) as ChangeRequestRow[];
    expect(rows.map((r) => r.requestId)).toContain('cr-late');
  });
});
