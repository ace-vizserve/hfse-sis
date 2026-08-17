import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// `resolveAcademicSummaryScope` is shared by four pages. Three of them cannot
// render without a masterfile payload, so they depend on its default behaviour
// of falling back to the FIRST grade level when `?level` is absent. Only the
// Academic Summary page may pass `allowAllLevels`, which turns that same state
// into the school-wide view and returns a null payload.
//
// This is a source scan rather than a behavioural test because the resolver
// talks to Supabase; what needs protecting is not the query but the fact that
// exactly one caller opts in. If a future page adopts the flag, it must render
// the all-levels state — adding it here is the deliberate step that says so.

const ROOT = process.cwd();

const CALLERS = [
  'app/(records)/records/academic-summary/page.tsx',
  'app/(markbook)/markbook/awards/page.tsx',
  'app/(attendance)/attendance/summary/page.tsx',
  'app/(evaluation)/evaluation/comments/page.tsx',
];

/** Pages allowed to request the school-wide state, and why. */
const ALLOWED_OPT_IN = new Set([
  'app/(records)/records/academic-summary/page.tsx',
]);

function read(relative: string): string {
  return readFileSync(join(ROOT, relative), 'utf8');
}

describe('all-levels scope is opt-in', () => {
  it('every known caller still calls the resolver', () => {
    for (const file of CALLERS) {
      expect(read(file), file).toContain('resolveAcademicSummaryScope');
    }
  });

  it('only the Academic Summary page passes allowAllLevels', () => {
    for (const file of CALLERS) {
      const optsIn = read(file).includes('allowAllLevels');
      expect(optsIn, `${file} opting in: ${optsIn}`).toBe(
        ALLOWED_OPT_IN.has(file)
      );
    }
  });

  it('the page that opts in also renders the school-wide view', () => {
    // Otherwise the flag would blank the page rather than change it.
    const source = read('app/(records)/records/academic-summary/page.tsx');
    expect(source).toContain('scope.allLevels');
    expect(source).toContain('AcademicOverviewView');
  });

  it('the empty-state branch does not swallow the school-wide state', () => {
    // The original guard was `scope.empty || scope.selectedLevelId === null`,
    // written when a null level could only mean "this year has no sections".
    // All-levels also has no selected level, so without excluding it the page
    // renders "No levels with sections configured" over a perfectly good year —
    // which is exactly what it did the first time it was opened in a browser.
    const source = read('app/(records)/records/academic-summary/page.tsx');
    const branch = source.match(
      /if \(([^)]*scope\.selectedLevelId === null[^)]*)\)/
    );
    expect(branch, 'empty-state branch not found').not.toBeNull();
    expect(branch![1]).toContain('!scope.allLevels');
  });

  it('the resolver defaults the flag to off', () => {
    const source = read('lib/markbook/academic-summary-scope.ts');
    expect(source).toMatch(
      /opts:\s*\{\s*allowAllLevels\?:\s*boolean\s*\}\s*=\s*\{\}/
    );
    expect(source).toContain('opts.allowAllLevels === true');
  });
});
