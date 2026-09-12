import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// Every module dashboard and Insights page offers "Export CSV" (2026-09-11).
// Adding a page here is how a new dashboard joins the rule.
//
// This is a SOURCE-TEXT scan, not a rendered check. It proves two things:
// (1) the page's file still references the shared <ExportCsvButton>
//     component by name — so a wrapper can't be moved into another file
//     while a same-named call site is left behind on the page, and
// (2) the page has a JSX call site for it — either directly, or via a
//     wrapper component whose own name ends in "ExportButton" (Attendance's
//     Suspense-streamed export button does this).
// It does NOT prove the button renders correctly at runtime, or that a
// wrapper's body still forwards to <ExportCsvButton> rather than a
// placeholder.
const PAGES = [
  'app/(attendance)/attendance/page.tsx',
  'app/(attendance)/attendance/insights/page.tsx',
  'app/(markbook)/markbook/page.tsx',
  'app/(markbook)/markbook/insights/page.tsx',
  'app/(admissions)/admissions/page.tsx',
  'app/(admissions)/admissions/insights/page.tsx',
  'app/(records)/records/page.tsx',
  'app/(records)/records/insights/page.tsx',
  'app/(p-files)/p-files/page.tsx',
  'app/(evaluation)/evaluation/page.tsx',
];

describe('dashboard and Insights pages offer CSV export', () => {
  it.each(PAGES)('%s renders ExportCsvButton', (page) => {
    const source = readFileSync(join(process.cwd(), page), 'utf8');
    // The shared component must still be named in this file...
    expect(source).toContain('ExportCsvButton');
    // ...and there must be a JSX call site for it, directly or via a wrapper.
    expect(source).toMatch(/<ExportCsvButton\b|<\w+ExportButton\b/);
  });
});
