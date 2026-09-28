import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

// Source-reading guard for every House Points write route (Task 5: events +
// scales; Task 6: entries + teams — this file globs the whole directory so
// both land under the same guard, same technique as
// __tests__/data/no-unpaginated-high-volume-reads.test.ts and
// __tests__/house-points/queries-shape.test.ts).
//
// Two things every route file under app/api/house-points MUST do, checked by
// reading its source rather than importing it (a route module reaches for
// `next/server` and cookies at import time, which a plain vitest run can't
// supply):
//
//   1. Gate on `requireRole([...HOUSE_POINTS_WRITERS])` — the feature's write
//      roster (lib/auth/student-record.ts). admissions is deliberately absent
//      from it; a route that gated on some other list would silently widen or
//      narrow who may write house points.
//   2. Call `logAction(` at least once — every write here is audited (the
//      global constraints' house_points.* action family).
//
// The directory-emptiness check matters as much as the per-file checks: an
// `expect(files).toEqual([])` loop over zero files passes trivially and would
// have let Task 5 ship with no route files at all and a green test.

const HOUSE_POINTS_DIR = path.join(process.cwd(), 'app', 'api', 'house-points');

function findRouteFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...findRouteFiles(full));
    } else if (entry === 'route.ts') {
      out.push(full);
    }
  }
  return out;
}

function relative(file: string): string {
  return file.slice(process.cwd().length + 1).replace(/\\/g, '/');
}

describe('every House Points API route enforces its write gate and audits its writes', () => {
  const routeFiles = findRouteFiles(HOUSE_POINTS_DIR);

  it('found more than 0 route files (a vacuous pass is not allowed)', () => {
    expect(routeFiles.length).toBeGreaterThan(0);
  });

  it('every route calls requireRole([...HOUSE_POINTS_WRITERS])', () => {
    const missing = routeFiles
      .map((file) => ({ file, source: readFileSync(file, 'utf8') }))
      .filter(
        ({ source }) =>
          !source.includes('requireRole([...HOUSE_POINTS_WRITERS])')
      )
      .map(({ file }) => relative(file));
    expect(missing).toEqual([]);
  });

  it('every route calls logAction(', () => {
    const missing = routeFiles
      .map((file) => ({ file, source: readFileSync(file, 'utf8') }))
      .filter(({ source }) => !source.includes('logAction('))
      .map(({ file }) => relative(file));
    expect(missing).toEqual([]);
  });
});
