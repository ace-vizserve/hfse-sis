import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/markbook/dashboard', () => ({
  getMarkbookTeacherPriority: vi.fn(async () => ({
    headline: { value: 6, label: 'unscored slots' },
    chips: [],
    cta: { label: 'Review', href: '/markbook/grading' },
  })),
}));
vi.mock('@/lib/evaluation/dashboard', () => ({
  getEvaluationTeacherPriority: vi.fn(async () => ({
    headline: { value: 4, label: 'write-ups still in draft' },
    chips: [],
    cta: { label: 'Review', href: '/evaluation' },
  })),
}));
vi.mock('@/lib/admissions/document-validation', () => ({
  countPendingDocValidation: vi.fn(async () => 5),
}));
vi.mock('@/lib/sis/unsynced-students', () => ({
  countUnsyncedEnrolledStudents: vi.fn(async () => 2),
}));
vi.mock('@/lib/p-files/document-validation', () => ({
  countAwaitingVerification: vi.fn(async () => 6),
}));
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn(async () => ({
        data: [
          {
            id: 'cr-1',
            requested_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
            grading_sheet: {
              section: { academic_year_id: 'ay-id' },
              subject: { name: 'Science' },
              term: { label: 'T2' },
            },
            requested_by_email: 'teacher@hfse.test',
          },
        ],
        error: null,
      })),
      maybeSingle: vi.fn(async () => ({ data: { id: 'ay-id' }, error: null })),
    })),
  })),
}));
vi.mock('@/lib/markbook/comment-completeness', () => ({
  cumulativeCommentGaps: vi.fn(async () => []),
}));

import { getHomeTodos } from '@/lib/home/todos';

describe('getHomeTodos', () => {
  it('gives teacher review-only rows from the teacher priority payloads', async () => {
    const todos = await getHomeTodos('teacher', 'AY2026', 'teacher-1');
    expect(todos).toEqual([
      {
        id: 'markbook-priority',
        module: 'Markbook',
        text: '6 unscored slots',
        href: '/markbook/grading',
        kind: 'review',
      },
      {
        id: 'evaluation-priority',
        module: 'Evaluation',
        text: '4 write-ups still in draft',
        href: '/evaluation',
        kind: 'review',
      },
    ]);
  });

  it('gives academic_coordinator review-only rows, never change-request rows', async () => {
    const todos = await getHomeTodos(
      'academic_coordinator',
      'AY2026',
      'coord-1'
    );
    expect(todos.every((t) => t.kind === 'review')).toBe(true);
    expect(todos.map((t) => t.module)).toEqual(['Admissions', 'Records']);
  });

  it('gives school_admin change-request rows with a requestId', async () => {
    const todos = await getHomeTodos('school_admin', 'AY2026', 'admin-1');
    const cr = todos.find((t) => t.kind === 'change-request');
    expect(cr).toBeDefined();
    expect(cr?.requestId).toBe('cr-1');
    expect(cr?.aging).toEqual({ label: '2 days', tone: 'success' });
  });

  it('never gives superadmin change-request rows (KD #41 — not in the approver pool)', async () => {
    const todos = await getHomeTodos('superadmin', 'AY2026', 'super-1');
    expect(todos.some((t) => t.kind === 'change-request')).toBe(false);
    expect(todos.map((t) => t.module)).toContain('P-Files');
  });
});
