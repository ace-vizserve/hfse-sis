import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { loadActivityPage, pageEvents, SOURCE_CAP } from '@/lib/activity/feed';
import type { ActivityEvent } from '@/lib/activity/events';

// `loadActivityPage` resolves display names outside the `service` client it's
// given — this stubs that lookup so the mark-change scoping tests below don't
// need real staff data, only the query shape.
vi.mock('@/lib/auth/staff-list', () => ({
  getStaffDisplayNameById: () => Promise.resolve([]),
}));

function ev(id: string, at: string): ActivityEvent {
  return {
    id,
    flow: 'grade_change',
    requestId: id,
    at,
    tone: 'started',
    actorLabel: 'Someone',
    actorInitials: 'S',
    predicate: 'did a thing.',
    details: null,
    href: '#',
  };
}

describe('pageEvents', () => {
  const all = [
    ev('a', '2026-08-28T05:00:00.000Z'),
    ev('b', '2026-08-28T04:00:00.000Z'),
    ev('c', '2026-08-28T03:00:00.000Z'),
    ev('d', '2026-08-28T02:00:00.000Z'),
    ev('e', '2026-08-28T01:00:00.000Z'),
  ];

  it('returns the newest page first and a cursor for the next', () => {
    const page = pageEvents(all, null, 2);

    expect(page.events.map((e) => e.id)).toEqual(['a', 'b']);
    expect(page.nextCursor).toEqual({
      at: '2026-08-28T04:00:00.000Z',
      id: 'b',
    });
  });

  it('continues from the cursor without repeating or skipping', () => {
    const first = pageEvents(all, null, 2);
    const second = pageEvents(all, first.nextCursor, 2);
    const third = pageEvents(all, second.nextCursor, 2);

    expect(second.events.map((e) => e.id)).toEqual(['c', 'd']);
    expect(third.events.map((e) => e.id)).toEqual(['e']);
    expect(third.nextCursor).toBeNull();
  });

  // The bug this guards: two sources that both emitted at the same instant.
  //
  // ⚠ THE TIED IDS ARE DELIBERATELY OUT OF ORDER IN THE ARRAY ('y' before
  // 'x'), and that is the whole point. `Array.prototype.sort` is stable, so a
  // fixture where the tied ids already happen to sit in ascending order (or
  // in their original input order) would pass this test even with NO id
  // tiebreak at all in `sortEventsNewestFirst` — it would just be relying on
  // sort stability by accident. Putting 'y' before 'x' in the input, while
  // the correct output orders 'x' before 'y', means only the real tiebreak
  // (`|| a.id.localeCompare(b.id)`) can produce the expected pages.
  it('does not lose an event that shares a timestamp with the cursor', () => {
    const tied = [
      ev('w', '2026-08-28T05:00:00.000Z'),
      ev('y', '2026-08-28T04:00:00.000Z'),
      ev('x', '2026-08-28T04:00:00.000Z'),
      ev('v', '2026-08-28T03:00:00.000Z'),
    ];

    const first = pageEvents(tied, null, 2);
    const second = pageEvents(tied, first.nextCursor, 2);

    expect(first.events.map((e) => e.id)).toEqual(['w', 'x']);
    expect(second.events.map((e) => e.id)).toEqual(['y', 'v']);
  });

  it('reports no next cursor when the last page exactly fills', () => {
    expect(pageEvents(all.slice(0, 2), null, 2).nextCursor).toBeNull();
  });

  it('caps each source well above anything this school produces', () => {
    expect(SOURCE_CAP).toBeGreaterThanOrEqual(400);
  });
});

/**
 * `grade_change_requests` is readable by ANY authenticated account holding a
 * role (migration 009) — the `.or()` scope built inside `loadMarkChangeSide`
 * is the ONLY thing standing between one teacher and the whole school's mark
 * changes. This asserts the shape of the query that guard produces, not its
 * results: a fake Supabase client whose `.or()` records what it was called
 * with, so a future edit that "simplifies" the filter away, or moves the
 * narrowing into a `.filter()` applied after the fetch, fails a test instead
 * of shipping a leak.
 */
function makeMarkChangeService(captured: {
  orClauses: string[];
}): SupabaseClient {
  return {
    from(table: string) {
      if (table !== 'grade_change_requests') {
        throw new Error(
          `mark-change scoping test queried an unexpected table: ${table}`
        );
      }
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      builder.select = chain;
      builder.order = chain;
      builder.limit = chain;
      builder.or = (clause: string) => {
        captured.orClauses.push(clause);
        return builder;
      };
      // Awaiting the builder resolves the query with no rows — this test
      // only cares what was asked for, never what comes back.
      builder.then = (
        resolve: (value: { data: unknown; error: null }) => unknown
      ) => resolve({ data: [], error: null });
      return builder;
    },
  } as unknown as SupabaseClient;
}

describe('loadActivityPage — mark-change scoping (the leak guard)', () => {
  it('a teacher is scoped to their own requested/approver rows, nothing broader', async () => {
    const captured = { orClauses: [] as string[] };
    await loadActivityPage(makeMarkChangeService(captured), {
      userId: 'teacher-1',
      role: 'teacher',
      tab: 'grade_change',
      cursor: null,
      limit: 20,
    });

    // Exactly one `.or()` call — the query never falls through to an
    // unfiltered fetch that gets narrowed afterward in JavaScript.
    expect(captured.orClauses).toHaveLength(1);
    const clause = captured.orClauses[0];
    expect(clause).toContain('requested_by.eq.teacher-1');
    expect(clause).toContain('primary_approver_id.eq.teacher-1');
    expect(clause).toContain('secondary_approver_id.eq.teacher-1');
    // ⚠ The legacy-null arm is gated to school_admin (next test). An
    // unconditional version here would hand a teacher every pending mark
    // change from before migration 013 had approver columns at all.
    expect(clause).not.toContain('is.null');
  });

  it('a school_admin additionally admits legacy rows with no approver assigned', async () => {
    const captured = { orClauses: [] as string[] };
    await loadActivityPage(makeMarkChangeService(captured), {
      userId: 'admin-1',
      role: 'school_admin',
      tab: 'grade_change',
      cursor: null,
      limit: 20,
    });

    expect(captured.orClauses).toHaveLength(1);
    expect(captured.orClauses[0]).toContain(
      'and(primary_approver_id.is.null,secondary_approver_id.is.null)'
    );
  });
});
