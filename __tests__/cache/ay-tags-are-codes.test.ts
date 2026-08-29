import { beforeAll, describe, expect, it, vi } from 'vitest';

// RUNTIME GUARD for the bug fixed in 706c3904: lib/markbook/dashboard.ts's
// `tag()` helper built `markbook:${academicYearId}` from a UUID, while the
// only emitter of that tag family — `invalidateDrillTags('markbook', ayCode)`
// in lib/cache/invalidate-drill-tags.ts — always emits `markbook:AY2026`
// shaped strings. The two could never match, so three cached dashboard
// panels were never invalidated by any write; they only expired on a 60s
// TTL. See __tests__/cache/write-route-invalidation.test.ts's
// "no tag template interpolates an id" test for the STATIC guard this
// complements — that one greps `tags: [...]` array literals, so it is
// structurally blind to `tags: tag(academicYearId)` (a CALL expression).
// This file is a RUNTIME check instead: it mocks `unstable_cache` to record
// the tags each cached loader actually constructs, then asserts on the real
// strings — catching the array-literal form, the helper-function form, and
// any shape a future refactor invents, because it looks at what the code
// DOES rather than how the source text is punctuated.
//
// ── how this works ──────────────────────────────────────────────────────
// `unstable_cache(fn, keyParts, opts)` is mocked to push `opts.tags` into a
// module-level array and return `fn` UNCHANGED. Every AY-scoped loader in
// this repo calls `unstable_cache(...)` INSIDE its exported function body
// (never at import time, bar a couple of module-level consts — those fire
// on import instead, which is still captured). So tags are captured the
// moment `unstable_cache(...)` is evaluated, before `fn` is ever invoked —
// which matters, because `fn` is the real uncached loader and WILL throw or
// reject against the stubbed Supabase client below. That is expected and
// safe: the assertions never depend on what `fn` returns, only on what got
// pushed into the tag array before it ran.

const { capturedTags } = vi.hoisted(() => ({ capturedTags: [] as string[] }));

vi.mock('next/cache', () => ({
  unstable_cache: (
    fn: (...args: unknown[]) => unknown,
    _keyParts: unknown,
    opts?: { tags?: string[] }
  ) => {
    if (opts?.tags) capturedTags.push(...opts.tags);
    return fn;
  },
  revalidateTag: vi.fn(),
}));

// createServiceClient() (and createAdmissionsClient(), which just delegates
// to it) throws immediately here — nothing under test needs a real DB
// round-trip, since tags are already captured by the time any query would
// run. A loader whose body reaches this and throws is expected and fine.
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => {
    throw new Error('stubbed service client — not needed for tag capture');
  }),
}));

import * as markbookDashboard from '@/lib/markbook/dashboard';
import * as markbookOverviewData from '@/lib/markbook/overview-data';
import * as markbookDrill from '@/lib/markbook/drill';
import * as attendanceDashboard from '@/lib/attendance/dashboard';
import * as attendanceDrill from '@/lib/attendance/drill';
import * as evaluationDashboard from '@/lib/evaluation/dashboard';
import * as evaluationDrill from '@/lib/evaluation/drill';
import * as admissionsDashboard from '@/lib/admissions/dashboard';
import * as admissionsDrill from '@/lib/admissions/drill';
import * as sisDashboard from '@/lib/sis/dashboard';
import * as sisDrill from '@/lib/sis/drill';

const FAKE_UUID = '11111111-1111-1111-1111-111111111111';

// A single rich object covers every shape these modules actually declare
// (`RangeInput`, `MarkbookTeacherPriorityInput`, `AttendancePriorityInput`,
// …) — all of them are plain `{ ayCode, ... }` objects, never destructured
// in the function SIGNATURE itself (TypeScript keeps the parameter as one
// named identifier typed by an interface), so one filler object satisfies
// whichever keys a given loader happens to read. Both an id-shaped value
// AND a code-shaped value are provided per concept, so a loader that reads
// the WRONG one (the historical bug: an `Id` field where a `Code` field
// belonged) still produces a tag this test can classify correctly.
const GENERIC_OBJECT_FILLER: Record<string, unknown> = {
  ayCode: 'AY2026',
  academicYearId: FAKE_UUID,
  compareAy: 'AY2026',
  compareAyId: FAKE_UUID,
  currentAy: 'AY2026',
  selectedAy: 'AY2026',
  targetAy: 'AY2026',
  prevAy: 'AY2026',
  closeCode: 'AY2026',
  ayId: FAKE_UUID,
  id: FAKE_UUID,
  teacherUserId: FAKE_UUID,
  termId: FAKE_UUID,
  from: '2026-01-01',
  to: '2026-01-31',
  cmpFrom: '2025-01-01',
  cmpTo: '2025-01-31',
  changeRequestsPending: 0,
  limit: 8,
  windowDays: 60,
  days: 30,
};

/** Maps a parameter's NAME to a plausible value for that name. Anything
 * unrecognised falls back to the rich filler object above — correct for
 * every object-typed parameter in these modules, and harmless for a plain
 * string parameter this list doesn't know about (worst case: that one
 * loader's tag capture is skipped, not a false pass). */
function fillForName(name: string): unknown {
  const n = name.trim();
  if (
    /^(ayCode|compareAy|currentAy|selectedAy|targetAy|closeCode|prevAy|ay)$/i.test(
      n
    )
  ) {
    return 'AY2026';
  }
  if (/(^|[a-z])Id$/.test(n) || /_id$/i.test(n) || /^id$/i.test(n)) {
    return FAKE_UUID;
  }
  return GENERIC_OBJECT_FILLER;
}

/** Extracts top-level parameter names from a function's own source text.
 * Works for both `function foo(a, b) {}` and `(a, b) => {}` because
 * vitest/esbuild compile TS to JS without minifying identifiers in the test
 * environment. Destructured params (`{ a, b }`) are returned as one opaque
 * chunk that doesn't match any name in `fillForName`, so they fall through
 * to `GENERIC_OBJECT_FILLER` — which is exactly the shape they want. */
function extractParamNames(fn: (...args: unknown[]) => unknown): string[] {
  const src = fn.toString();
  const match = /^(?:async\s+)?(?:function\s*[^(]*)?\(([^)]*)\)/.exec(src);
  if (!match || !match[1].trim()) return [];
  const inner = match[1];
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of inner) {
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    if (ch === ')' || ch === ']' || ch === '}') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current);
  return parts.map((p) => p.split('=')[0].trim());
}

/** Calls every exported function in a module with best-guess filler args,
 * swallowing any error — a thrown/rejected loader is expected (see the
 * mock comment above) and irrelevant to what this test checks. */
async function exerciseModule(ns: Record<string, unknown>): Promise<void> {
  for (const value of Object.values(ns)) {
    if (typeof value !== 'function') continue;
    const fn = value as (...args: unknown[]) => unknown;
    const args = extractParamNames(fn).map(fillForName);
    try {
      const result = fn(...args);
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        await (result as Promise<unknown>).catch(() => undefined);
      }
    } catch {
      // Expected — see module comment.
    }
  }
}

const MODULES: Record<string, Record<string, unknown>> = {
  'lib/markbook/dashboard': markbookDashboard,
  'lib/markbook/overview-data': markbookOverviewData,
  'lib/markbook/drill': markbookDrill,
  'lib/attendance/dashboard': attendanceDashboard,
  'lib/attendance/drill': attendanceDrill,
  'lib/evaluation/dashboard': evaluationDashboard,
  'lib/evaluation/drill': evaluationDrill,
  'lib/admissions/dashboard': admissionsDashboard,
  'lib/admissions/drill': admissionsDrill,
  'lib/sis/dashboard': sisDashboard,
  'lib/sis/drill': sisDrill,
};

describe('AY-scoped cache tags are always codes, never ids (runtime)', () => {
  beforeAll(async () => {
    for (const ns of Object.values(MODULES)) {
      await exerciseModule(ns);
    }
  });

  it('actually captured tags — a count of 0 means the mocks broke, not that the code is clean', () => {
    expect(capturedTags.length).toBeGreaterThan(20);
  });

  it('no captured tag contains a uuid', () => {
    const uuidRe =
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    const offenders = [...new Set(capturedTags.filter((t) => uuidRe.test(t)))];
    expect(
      offenders,
      'A cache tag built from a uuid can never be busted by ' +
        'invalidateDrillTags(), which only ever emits ay_code-shaped tags. ' +
        'This is exactly the bug fixed in 706c3904.'
    ).toEqual([]);
  });

  it('every colon-scoped tag ends in an AY code', () => {
    const offenders = [
      ...new Set(
        capturedTags.filter((t) => t.includes(':') && !/:AY\d{4}$/.test(t))
      ),
    ];
    expect(
      offenders,
      'An AY-scoped cache tag must end `:AY<year>` — that is the only shape ' +
        'invalidateDrillTags() ever emits.'
    ).toEqual([]);
  });
});
