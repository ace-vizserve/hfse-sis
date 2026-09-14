/**
 * The shared audit-log filter parser and query applier.
 *
 * Every bug asserted here was live in production on at least one of the seven
 * audit-log pages, and none of them would ever have been reported as "the
 * filter is broken" — they hide rows quietly.
 */
import { describe, expect, it } from 'vitest';

import { applyAuditFilters, parseAuditFilters } from '@/lib/audit/filters';

const ALLOWLIST = ['sheet.lock', 'entry.update', 'totals.update'] as const;

/** Records what would have been sent to PostgREST. */
function recordingQuery() {
  const calls: Array<[string, string, string]> = [];
  const q = {
    eq(column: string, value: string) {
      calls.push(['eq', column, value]);
      return q;
    },
    gte(column: string, value: string) {
      calls.push(['gte', column, value]);
      return q;
    },
    lt(column: string, value: string) {
      calls.push(['lt', column, value]);
      return q;
    },
  };
  return { q, calls };
}

describe('parseAuditFilters', () => {
  it('keeps an action that is on the module allowlist', () => {
    expect(parseAuditFilters({ action: 'sheet.lock' }, ALLOWLIST).action).toBe(
      'sheet.lock'
    );
  });

  // The value reaches a PostgREST `eq`, and the allowlist is already the set of
  // actions the page is permitted to show — so this both blocks an injected
  // filter and stops one module's page being used to read another's rows.
  it('drops an action that is not on the allowlist', () => {
    expect(
      parseAuditFilters({ action: 'user.delete' }, ALLOWLIST).action
    ).toBeNull();
  });

  it('drops a malformed date rather than passing it through', () => {
    // `new Date('last week')` is Invalid Date, and an invalid bound matches
    // nothing — which reads to the user as "there are no entries" instead of
    // "that is not a date".
    const f = parseAuditFilters({ from: 'last week', to: '2026-13-99' }, []);
    expect(f.from).toBeNull();
    expect(f.to).toBeNull();
  });

  it('swaps a backwards window instead of returning nothing', () => {
    const f = parseAuditFilters({ from: '2026-09-30', to: '2026-09-01' }, []);
    expect(f.from).toBe('2026-09-01');
    expect(f.to).toBe('2026-09-30');
  });

  it('treats a blank actor as no filter', () => {
    expect(parseAuditFilters({ actor: '   ' }, []).actor).toBeNull();
  });
});

describe('applyAuditFilters', () => {
  it('matches the actor exactly, never as a substring', () => {
    // The attendance page used `ilike '%value%'`, so one address could select
    // rows belonging to another that contained it.
    const { q, calls } = recordingQuery();
    applyAuditFilters(q, parseAuditFilters({ actor: 'a@hfse.edu.sg' }, []));
    expect(calls).toContainEqual(['eq', 'actor_email', 'a@hfse.edu.sg']);
    expect(calls.some(([op]) => op !== 'eq')).toBe(false);
  });

  // ⚠ THE TWO BOUNDS ARE THE WHOLE POINT OF THIS FILE.
  it('covers the entire last day, in Singapore time', () => {
    const { q, calls } = recordingQuery();
    applyAuditFilters(
      q,
      parseAuditFilters({ from: '2026-09-14', to: '2026-09-14' }, [])
    );

    // Starts at Singapore midnight, not the server's midnight. A bare
    // '2026-09-14T00:00:00' resolves in the server zone — UTC in production —
    // which is 08:00 in Singapore, so a day filter would silently drop
    // everything staff did before 8am.
    expect(calls).toContainEqual([
      'gte',
      'created_at',
      '2026-09-14T00:00:00+08:00',
    ]);

    // Ends at the NEXT Singapore midnight, exclusive. `lte` on the chosen day
    // would mean midnight and exclude the whole day the user picked.
    expect(calls).toContainEqual([
      'lt',
      'created_at',
      '2026-09-15T00:00:00+08:00',
    ]);
  });

  it('rolls the exclusive bound across a month end', () => {
    const { q, calls } = recordingQuery();
    applyAuditFilters(q, parseAuditFilters({ to: '2026-09-30' }, []));
    expect(calls).toContainEqual([
      'lt',
      'created_at',
      '2026-10-01T00:00:00+08:00',
    ]);
  });

  it('adds nothing when no filter is set', () => {
    const { q, calls } = recordingQuery();
    applyAuditFilters(q, parseAuditFilters({}, ALLOWLIST));
    expect(calls).toEqual([]);
  });
});
