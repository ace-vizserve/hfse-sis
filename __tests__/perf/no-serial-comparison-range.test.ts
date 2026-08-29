/**
 * A `RangeResult` builder must fetch its current and comparison windows
 * TOGETHER.
 *
 * WHY THIS EXISTS. Every dashboard in this app renders through one shape: a
 * `RangeInput` carrying `from`/`to` plus an optional `cmpFrom`/`cmpTo`, and a
 * `RangeResult` carrying `current`, `comparison` and a delta between them (KD
 * #74/#80). Five builders across four modules wrote it the obvious way —
 * `const current = await load(input)`, a null-guard, then `const comparison =
 * await load(cmp)` — and the comparison window is not downstream of the
 * current one. Neither read consumes the other's result; the delta is computed
 * from both afterwards. So turning compare mode on cost exactly twice the
 * latency of the plain view, and on the SIS audit-by-module card that meant two
 * serial waves of six `count` queries each.
 *
 * The five, all fixed 2026-08-29 (phase 4 of the app-wide query pass):
 *   lib/markbook/dashboard.ts   loadMarkbookKpisRangeUncached
 *   lib/p-files/dashboard.ts    loadPFilesKpisRangeUncached
 *   lib/sis/dashboard.ts        loadRecordsKpisRangeUncached
 *   lib/sis/dashboard.ts        loadAuditActivityByModuleUncached
 *   lib/sis/dashboard.ts        loadAuditDailyTrendUncached
 *
 * HOW IT READS. Source-scanning, the same technique as
 * `__tests__/data/no-unpaginated-high-volume-reads.test.ts` — these are server
 * modules whose call graphs reach `createServiceClient()` and cannot be
 * imported and inspected at runtime.
 *
 * ⚠ WHAT IT DOES *NOT* CLAIM. Matching source text cannot prove a builder is
 * parallel; it can only prove nobody re-introduced the exact spelling the five
 * shared. That is worth having anyway, because the shape is contagious — it is
 * what you write when you copy the neighbouring builder, which is how it
 * reached five sites in four modules. The `waves` numbers in
 * `__tests__/perf/query-budget.test.ts` are the measurement; this is the
 * spelling guard beside it.
 *
 * ⚠ AND THE BUILDERS THAT LOOK LIKE THIS BUT ARE NOT. `lib/admissions/
 * dashboard.ts`, `lib/attendance/dashboard.ts` and `lib/evaluation/
 * dashboard.ts` also return `RangeResult`s, and were checked: each loads its
 * rows ONCE (`loadJoinedRows`, `loadDailyRows`, `loadWriteups`) and buckets
 * both windows out of that one set in memory. They issue no second query, so
 * there is nothing to parallelise and nothing here for them to trip over.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(__dirname, '..', '..');
const SKIP_DIRS = new Set(['.claude', 'node_modules', '.next', '.git']);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) out.push(full);
  }
  return out;
}

function relative(file: string): string {
  return file.slice(REPO_ROOT.length + 1).replace(/\\/g, '/');
}

/**
 * The exact spelling all five shared: a `comparison` binding produced by its
 * own top-level `await`, which by construction cannot overlap the `current`
 * one above it. A parallel builder names both in one destructure
 * (`const [current, comparison] = await Promise.all([...])`), which this does
 * not match.
 */
const SERIAL_COMPARISON = /\bconst\s+comparison\s*=\s*await\b/;

describe('range builders fetch current and comparison together', () => {
  it('no `const comparison = await` anywhere in app/ or lib/', () => {
    const files = [
      ...walk(join(REPO_ROOT, 'lib')),
      ...walk(join(REPO_ROOT, 'app')),
    ];
    const offenders = files
      .filter((f) => SERIAL_COMPARISON.test(readFileSync(f, 'utf8')))
      .map(relative);

    expect(
      offenders,
      'A `RangeResult` builder awaited its comparison window after its current ' +
        'one. The two windows are disjoint and neither reads the other, so ' +
        'they belong in one `Promise.all` — see the header of this file for ' +
        'the five that were fixed in phase 4.'
    ).toEqual([]);
  });

  it('the five fixed builders still name both windows in one destructure', () => {
    const expected: Array<[string, number]> = [
      ['lib/markbook/dashboard.ts', 1],
      ['lib/p-files/dashboard.ts', 1],
      ['lib/sis/dashboard.ts', 3],
    ];
    for (const [file, count] of expected) {
      const source = readFileSync(join(REPO_ROOT, file), 'utf8');
      const matches = source.match(
        /const\s+\[\s*current\s*,\s*comparison\s*\]\s*=\s*await\s+Promise\.all/g
      );
      expect(
        matches?.length ?? 0,
        `${file} should hold ${count} parallel range builder(s)`
      ).toBe(count);
    }
  });
});
