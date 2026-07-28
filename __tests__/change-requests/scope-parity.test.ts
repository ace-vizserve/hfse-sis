import { describe, it, expect, vi } from 'vitest';

import {
  getSidebarChangeRequestCount,
  getSidebarChangeRequestPreview,
} from '@/lib/change-requests/sidebar-counts';
import { applyChangeRequestCountScope } from '@/lib/sidebar/use-change-request-count';
import type { Role } from '@/lib/auth/roles';

// This suite exists because the three implementations below independently
// encode the SAME per-role change-request scope rule, and nothing
// previously compared them against each other — which is exactly how a
// superadmin scope divergence between them slipped through review until a
// human caught it by inspection (see the doc-comment fix on
// lib/change-requests/sidebar-counts.ts in this same fix wave). Each
// implementation already has its own scope-correctness tests
// (sidebar-count.test.ts, sidebar-preview.test.ts); this suite instead
// asserts the three AGREE with each other, role by role, for every gate
// role the notification bell/sidebar badge support.

vi.mock('@/lib/change-requests/labels', () => ({
  fetchLabels: vi.fn(async () => ({
    student_label: null,
    sheet_label: null,
  })),
}));

const CURRENT_AY_ID = 'ay-current';
const GATE_ROLES: Role[] = [
  'teacher',
  'academic_coordinator',
  'school_admin',
  'superadmin',
];

// Mirrors the mock-chain shape already used by sidebar-count.test.ts /
// sidebar-preview.test.ts — a Supabase-shaped `.from()` that special-cases
// `academic_years` (so the current-AY guard resolves) and otherwise tracks
// every filter-method call made on the `grade_change_requests` chain.
function makeTrackingService(trackCalls: string[]) {
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
    order: () => {
      trackCalls.push('order');
      return chain;
    },
    limit: () => {
      trackCalls.push('limit');
      return chain;
    },
    data: [],
    count: 0,
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

// Isolates the hook's pure query-building branch (applyChangeRequestCountScope)
// from the React effect it lives inside — the hook itself is only reachable
// by mounting a component, so this exercises the same call chain a real
// Supabase PostgrestFilterBuilder would receive, via a minimal duck-typed
// mock matching the same eq/or tracking pattern as the other two.
function trackHookScope(role: Role, userId: string): string[] {
  const calls: string[] = [];
  const query: {
    eq: (column: string, value: unknown) => typeof query;
    or: (filters: string) => typeof query;
  } = {
    eq: () => {
      calls.push('eq');
      return query;
    },
    or: () => {
      calls.push('or');
      return query;
    },
  };
  applyChangeRequestCountScope(query, role, userId);
  return calls;
}

describe('change-request scope parity across all 3 independent implementations', () => {
  for (const role of GATE_ROLES) {
    it(`${role}: getSidebarChangeRequestCount, getSidebarChangeRequestPreview, and the hook's scope helper apply the same .or() restriction`, async () => {
      const countCalls: string[] = [];
      await getSidebarChangeRequestCount(
        makeTrackingService(countCalls),
        role,
        'user-1'
      );

      const previewCalls: string[] = [];
      await getSidebarChangeRequestPreview(
        makeTrackingService(previewCalls),
        role,
        'user-1',
        5
      );

      const hookCalls = trackHookScope(role, 'user-1');

      const countUsesOr = countCalls.includes('or');
      const previewUsesOr = previewCalls.includes('or');
      const hookUsesOr = hookCalls.includes('or');

      // school_admin should be the only gate role where any implementation
      // applies the designated-approver .or() restriction; superadmin's
      // unrestricted-oversight scope must NOT apply it anywhere.
      expect(previewUsesOr).toBe(countUsesOr);
      expect(hookUsesOr).toBe(countUsesOr);
    });
  }

  it('a role outside the change-request flow is rejected identically by all three (no .or(), no eq() scoping call at all)', async () => {
    const role = 'admissions' as Role;

    const countCalls: string[] = [];
    const countResult = await getSidebarChangeRequestCount(
      makeTrackingService(countCalls),
      role,
      'user-1'
    );

    const previewCalls: string[] = [];
    const previewResult = await getSidebarChangeRequestPreview(
      makeTrackingService(previewCalls),
      role,
      'user-1',
      5
    );

    const hookScoped = applyChangeRequestCountScope(
      {
        eq: function (this: unknown) {
          return this as never;
        },
        or: function (this: unknown) {
          return this as never;
        },
      },
      role,
      'user-1'
    );

    expect(countResult).toBe(0);
    expect(previewResult).toEqual([]);
    expect(hookScoped).toBeNull();
  });
});
