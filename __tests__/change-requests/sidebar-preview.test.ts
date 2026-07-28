import { describe, it, expect, vi } from 'vitest';
import { getSidebarChangeRequestPreview } from '@/lib/change-requests/sidebar-counts';

vi.mock('@/lib/change-requests/labels', () => ({
  fetchLabels: vi.fn(async () => ({
    student_label: 'Tan, Grace (STU-001)',
    sheet_label: 'P4 Obedience · English · Term 1',
  })),
}));

const CURRENT_AY_ID = 'ay-current';

function makeService(
  rows: Array<Record<string, unknown>>,
  trackCalls?: string[]
) {
  const chain: Record<string, unknown> = {
    select: () => {
      if (trackCalls) trackCalls.push('select');
      return chain;
    },
    eq: () => {
      if (trackCalls) trackCalls.push('eq');
      return chain;
    },
    or: () => {
      if (trackCalls) trackCalls.push('or');
      return chain;
    },
    order: () => {
      if (trackCalls) trackCalls.push('order');
      return chain;
    },
    limit: () => {
      if (trackCalls) trackCalls.push('limit');
      return chain;
    },
    data: rows,
    error: null,
  };
  return {
    from: (table: string) => {
      if (table === 'academic_years') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { id: CURRENT_AY_ID },
                error: null,
              }),
            }),
          }),
        };
      }
      return chain;
    },
  } as never;
}

const ROW = {
  id: 'cr-1',
  field_changed: 'ww_scores',
  reason_category: 'regrading',
  requested_at: '2026-07-27T00:00:00.000Z',
  grading_sheet_id: 'sheet-1',
  grade_entry_id: 'entry-1',
};

describe('getSidebarChangeRequestPreview', () => {
  it('teacher: returns rows with resolved labels', async () => {
    const service = makeService([ROW]);

    const result = await getSidebarChangeRequestPreview(
      service,
      'teacher',
      'user-1',
      5
    );

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('cr-1');
    expect(result[0].student_label).toBe('Tan, Grace (STU-001)');
    expect(result[0].sheet_label).toBe('P4 Obedience · English · Term 1');
  });

  it('school_admin: returns rows with resolved labels', async () => {
    const service = makeService([ROW]);
    const result = await getSidebarChangeRequestPreview(
      service,
      'school_admin',
      'user-1',
      5
    );
    expect(result).toHaveLength(1);
  });

  it('a role outside the change-request flow returns an empty array', async () => {
    const service = makeService([ROW]);
    const result = await getSidebarChangeRequestPreview(
      service,
      'admissions',
      'user-1',
      5
    );
    expect(result).toEqual([]);
  });

  it('no current AY returns an empty array without querying rows', async () => {
    const service = {
      from: (table: string) => {
        if (table === 'academic_years') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
          };
        }
        throw new Error('should not query grade_change_requests');
      },
    } as never;
    const result = await getSidebarChangeRequestPreview(
      service,
      'school_admin',
      'user-1',
      5
    );
    expect(result).toEqual([]);
  });

  it('school_admin: applies designated-approver restriction via .or()', async () => {
    const calls: string[] = [];
    const service = makeService([ROW], calls);
    await getSidebarChangeRequestPreview(service, 'school_admin', 'user-1', 5);
    // school_admin should call .or() to restrict to designated approvers
    expect(calls).toContain('or');
  });

  it('superadmin: does NOT apply designated-approver restriction (oversight scope)', async () => {
    const calls: string[] = [];
    const service = makeService([ROW], calls);
    await getSidebarChangeRequestPreview(service, 'superadmin', 'user-1', 5);
    // superadmin should NOT call .or() — it has unrestricted oversight
    expect(calls).not.toContain('or');
  });

  it('superadmin: returns all pending rows', async () => {
    const service = makeService([ROW]);
    const result = await getSidebarChangeRequestPreview(
      service,
      'superadmin',
      'user-1',
      5
    );
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('cr-1');
  });
});
