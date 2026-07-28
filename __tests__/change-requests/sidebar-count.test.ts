import { describe, it, expect } from 'vitest';
import { getSidebarChangeRequestCount } from '@/lib/change-requests/sidebar-counts';

const CURRENT_AY_ID = 'ay-current';

// Mock Supabase service for count queries (uses { count: 'exact', head: true })
function makeCountService(count: number | null) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    or: () => chain,
    count: count,
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

// Mock service that tracks method calls
function makeCountServiceWithTracking(count: number, trackCalls: string[]) {
  const chain: Record<string, unknown> = {
    select: () => {
      trackCalls.push('select');
      return chain;
    },
    eq: () => {
      trackCalls.push('eq');
      return chain;
    },
    or: () => {
      trackCalls.push('or');
      return chain;
    },
    count: count,
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

describe('getSidebarChangeRequestCount', () => {
  it('teacher: returns count of own pending requests', async () => {
    const service = makeCountService(3);
    const result = await getSidebarChangeRequestCount(
      service,
      'teacher',
      'user-1'
    );
    expect(result).toBe(3);
  });

  it('academic_coordinator: returns count of approved requests', async () => {
    const service = makeCountService(2);
    const result = await getSidebarChangeRequestCount(
      service,
      'academic_coordinator',
      'user-1'
    );
    expect(result).toBe(2);
  });

  it('school_admin: returns count of pending requests where user is designated approver', async () => {
    const service = makeCountService(5);
    const result = await getSidebarChangeRequestCount(
      service,
      'school_admin',
      'user-1'
    );
    expect(result).toBe(5);
  });

  it('school_admin: applies designated-approver restriction via .or()', async () => {
    const calls: string[] = [];
    const service = makeCountServiceWithTracking(5, calls);
    await getSidebarChangeRequestCount(service, 'school_admin', 'user-1');
    // school_admin should call .or() to restrict to designated approvers
    expect(calls).toContain('or');
  });

  it('superadmin: returns count of all pending requests (unrestricted oversight)', async () => {
    const service = makeCountService(10);
    const result = await getSidebarChangeRequestCount(
      service,
      'superadmin',
      'user-1'
    );
    expect(result).toBe(10);
  });

  it('superadmin: does NOT apply designated-approver restriction (oversight scope)', async () => {
    const calls: string[] = [];
    const service = makeCountServiceWithTracking(10, calls);
    await getSidebarChangeRequestCount(service, 'superadmin', 'user-1');
    // superadmin should NOT call .or() — it has unrestricted oversight
    expect(calls).not.toContain('or');
  });

  it('unsupported role returns 0', async () => {
    const service = makeCountService(5);
    const result = await getSidebarChangeRequestCount(
      service,
      'admissions',
      'user-1'
    );
    expect(result).toBe(0);
  });

  it('no current AY returns 0 without querying rows', async () => {
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
    const result = await getSidebarChangeRequestCount(
      service,
      'teacher',
      'user-1'
    );
    expect(result).toBe(0);
  });

  it('query error returns 0', async () => {
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      or: () => chain,
      count: null,
      error: new Error('query error'),
    };
    const service = {
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
    const result = await getSidebarChangeRequestCount(
      service,
      'school_admin',
      'user-1'
    );
    expect(result).toBe(0);
  });
});
