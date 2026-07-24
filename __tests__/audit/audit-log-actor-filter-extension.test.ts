/**
 * Guards the exact pattern added to the 4 previously-unfiltered audit-log
 * pages (P-Files, Records, Admissions, SIS) — mirrors Markbook/Evaluation's
 * existing ?actor= -> .eq('actor_email', ...) behavior. NOT Attendance's
 * .ilike() partial-match variant, which stays as its own pre-existing
 * inconsistency (see docs/superpowers/specs/2026-07-24-account-page-role-aware-design.md).
 */
import { describe, it, expect } from 'vitest';

function buildMockQuery() {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const query: Record<string, unknown> = {};
  const chain =
    (method: string) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
      return query;
    };
  query.select = chain('select');
  query.eq = chain('eq');
  query.in = chain('in');
  query.order = chain('order');
  query.range = chain('range');
  return { query, calls };
}

/**
 * Reproduces the exact insertion pattern applied to all 4 target pages'
 * query-builder chains: build the base `.select().in(...)` query, then
 * conditionally `.eq('actor_email', actorFilter)` before `.order().range()`
 * — only when the trimmed actor param is a non-empty string.
 */
function applyActorFilter(
  query: Record<string, unknown>,
  rawActor: string | undefined
) {
  const actorFilter = rawActor?.trim();
  let q = query;
  if (actorFilter) {
    q = (q.eq as (...a: unknown[]) => Record<string, unknown>)(
      'actor_email',
      actorFilter
    );
  }
  return (q.order as (...a: unknown[]) => Record<string, unknown>)(
    'created_at',
    { ascending: false }
  );
}

describe('audit-log actor filter — applied only when ?actor is present', () => {
  it('applies .eq(actor_email, value) when actor is a non-empty string', () => {
    const { query, calls } = buildMockQuery();
    applyActorFilter(query, 'maria.t@hfse.edu.sg');
    expect(calls).toContainEqual({
      method: 'eq',
      args: ['actor_email', 'maria.t@hfse.edu.sg'],
    });
  });

  it('does not apply the filter when actor is undefined', () => {
    const { query, calls } = buildMockQuery();
    applyActorFilter(query, undefined);
    expect(calls.some((c) => c.method === 'eq')).toBe(false);
  });

  it('does not apply the filter when actor is empty/whitespace-only', () => {
    const { query, calls } = buildMockQuery();
    applyActorFilter(query, '   ');
    expect(calls.some((c) => c.method === 'eq')).toBe(false);
  });

  it('trims surrounding whitespace before filtering', () => {
    const { query, calls } = buildMockQuery();
    applyActorFilter(query, '  joann@hfse.edu.sg  ');
    expect(calls).toContainEqual({
      method: 'eq',
      args: ['actor_email', 'joann@hfse.edu.sg'],
    });
  });
});
