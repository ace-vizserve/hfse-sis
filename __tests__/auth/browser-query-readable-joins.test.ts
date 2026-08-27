import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

// A BROWSER QUERY MAY ONLY INNER-JOIN A TABLE THE BROWSER CAN READ.
//
// ── the bug this exists to stop ───────────────────────────────────────────
//
// The declarations bell recounted with:
//
//   .from('approval_request_stages')
//   .select('id, approval_requests!inner(flow, status)', { count: 'exact' })
//
// Migration 129 gave `approval_request_stages` a scoped SELECT policy. It did
// not touch `approval_requests`, which 126 had left at `using (false)` for
// `authenticated`. Under RLS an inner join to a relation returning no rows
// drops every parent row, so the recount came back 0 for everybody who had
// declaration work waiting.
//
// ⚠ AND IT COULD NOT BE SEEN. 126 denies with a POLICY, not a revoked grant,
// so PostgREST raises nothing — the call returns `{ count: 0, error: null }`.
// The hook's "log it and freeze" branch is gated on `error` and never ran. The
// badge just went to zero, quietly, and the server-rendered seed being correct
// made it look like a realtime problem rather than a wrong answer.
//
// ⚠ TYPES CANNOT CATCH THIS AND NEITHER CAN A UNIT TEST OF THE HOOK. The query
// is a string, the failure is a policy in a different repo-half, and mocking
// Supabase makes every join succeed. The only cheap guard is this one: name
// every table a browser query inner-joins, and require somebody to have
// decided it is readable.
//
// ── how to satisfy it ─────────────────────────────────────────────────────
//
// Add the table below WITH the policy that makes it readable. If there is no
// such policy, the query is wrong — write the policy, or reshape the query so
// it does not join.

/**
 * Tables an inner join may target from the browser, and why each is readable.
 *
 * ⚠ "Readable" means a signed-in user gets rows back. A table with RLS enabled
 * and no permissive SELECT policy is NOT readable, however many rows it holds.
 */
const BROWSER_READABLE: Record<string, string> = {
  grading_sheets:
    'migration 005 — is_registrar_or_above() or is_teacher_for_sheet(id).',
  sections:
    'no RLS at all — never had an `enable row level security` statement.',
  approval_requests:
    'migration 131 — readable where the reader is on one of its own stages, ' +
    'mirroring 129. Before 131 this was `using (false)` and the join it ' +
    'serves silently returned nothing.',
};

/** Files that talk to Supabase as the signed-in user rather than service-role. */
function browserClientFiles(): string[] {
  const out = execFileSync(
    'git',
    [
      'grep',
      '-l',
      "from '@/lib/supabase/client'",
      '--',
      'lib',
      'components',
      'app',
    ],
    { encoding: 'utf8' }
  );
  return out.split('\n').filter(Boolean);
}

/** Every `<table>!inner` target named in a file. */
function innerJoinTargets(source: string): string[] {
  // Matches `approval_requests!inner(` and the aliased
  // `grading_sheet:grading_sheets!inner(` form alike — the table name is
  // whatever sits immediately before `!inner`.
  const found = new Set<string>();
  for (const m of source.matchAll(/([a-z_][a-z0-9_]*)!inner/gi)) {
    found.add(m[1]);
  }
  return [...found];
}

describe('browser queries only inner-join tables the browser can read', () => {
  const files = browserClientFiles();

  it('finds the files that query as the signed-in user', () => {
    // If this ever returns nothing the guard has silently stopped guarding —
    // a rename of the client module would do it.
    expect(files.length).toBeGreaterThan(0);
  });

  it('every inner-join target is a table with a permissive SELECT policy', () => {
    const unaccounted: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const table of innerJoinTargets(source)) {
        if (!(table in BROWSER_READABLE)) {
          unaccounted.push(`${file} joins \`${table}\``);
        }
      }
    }
    expect(
      unaccounted,
      'Each of these is inner-joined from the browser but nobody has recorded ' +
        'that a signed-in user can read it. Under RLS an inner join to an ' +
        'unreadable table returns ZERO rows and NO error. Add it to ' +
        'BROWSER_READABLE with the policy that makes it readable, or reshape ' +
        'the query.'
    ).toEqual([]);
  });

  it('proves the extractor actually finds joins', () => {
    // A guard whose regex matches nothing passes forever — the exact mistake
    // the CORS check shipped (KD #195). So check it on the two real shapes.
    expect(
      innerJoinTargets(`.select('id, approval_requests!inner(flow, status)')`)
    ).toEqual(['approval_requests']);
    expect(
      innerJoinTargets(
        `'id, grading_sheet:grading_sheets!inner(section:sections!inner(academic_year_id))'`
      ).sort()
    ).toEqual(['grading_sheets', 'sections']);
  });

  it('has no stale entries', () => {
    // An allowlist that outlives its call sites teaches the next reader that a
    // table is load-bearing when nothing reads it.
    const joined = new Set(
      files.flatMap((f) => innerJoinTargets(readFileSync(f, 'utf8')))
    );
    const stale = Object.keys(BROWSER_READABLE).filter((t) => !joined.has(t));
    expect(
      stale,
      'No browser query inner-joins these any more; drop them from the list.'
    ).toEqual([]);
  });
});
