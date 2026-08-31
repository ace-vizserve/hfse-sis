import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

// A REPORT LABEL MAY ONLY REACH A REPORT CARD.
//
// ── the bug this exists to prevent, which already happened once ───────────
//
// `subjects.report_label` (migration 087) answered "what does the REPORT CARD
// call this subject". Migration 137 added `display_name` — "what is it called
// this year" — and the resolver chained them: display_name -> report_label ->
// name. That chain had no callers, so it looked harmless.
//
// The 2026-08-31 read sweep gave it callers across the markbook, classroom and
// grading screens. The moment it did, MAPEH's report label of 'STAR' started
// answering for AY2025 markbook screens — the year that is supposed to keep
// saying MAPEH. Nothing failed. No test went red. The screens just quietly
// disagreed with each other about what a subject is called.
//
// Migration 138 split the column (both overrides are per academic year now) and
// lib/sis/subjects/display-name.ts split the rule into two functions. This test
// is what keeps them split: `subjectReportName` is narrower than
// `subjectDisplayName`, so importing it outside the report card silently widens
// a label back onto screens it was never meant to touch.
//
// ⚠ Demonstrated RED before green: adding the import to lib/markbook/drill.ts
// fails this test by name.

/** The only files allowed to ask what a subject is called ON A REPORT CARD. */
const REPORT_CARD_FILES = [
  // Builds the card payload; resolves the subject list and the fan-in targets.
  'lib/report-card/build-report-card.ts',
  // Composes a fan-in row's "{Target} ({Source})" heading ahead of render.
  'lib/report-card/resolve-report-subjects.ts',
  // Renders the subject cell.
  'components/report-card/report-card-document.tsx',
  // The rule itself.
  'lib/sis/subjects/display-name.ts',
];

/**
 * Source with comments stripped.
 *
 * Both of these fields are explained in prose in several files that no longer
 * touch them — "report_label moved to subject_configs in migration 138" is
 * exactly the comment a reader needs, and a guard that punished it would push
 * people to delete the explanation. The rule is about READING the column, so
 * the scan looks at code only.
 */
function codeOf(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function sourceFiles(): string[] {
  return execFileSync(
    'git',
    [
      'ls-files',
      'app/**/*.ts',
      'app/**/*.tsx',
      'lib/**/*.ts',
      'lib/**/*.tsx',
      'components/**/*.ts',
      'components/**/*.tsx',
    ],
    { encoding: 'utf8' }
  )
    .split('\n')
    .filter(Boolean);
}

describe('subjectReportName stays on the report card', () => {
  it('is imported by report-card files only', () => {
    const users = sourceFiles().filter((file) =>
      /\bsubjectReportName\b/.test(codeOf(file))
    );
    const strays = users.filter((f) => !REPORT_CARD_FILES.includes(f));
    expect(strays).toEqual([]);
  }, 30_000);

  it('every allowed file still uses it — the list is not stale', () => {
    // An allowance that describes nothing reads as "reviewed and fine" over
    // code that has moved on, exactly like a stale cache exemption.
    const unused = REPORT_CARD_FILES.filter((file) => {
      try {
        return !/\bsubjectReportName\b/.test(codeOf(file));
      } catch {
        return true; // gone
      }
    });
    expect(unused).toEqual([]);
  });

  it('no file reads a subject_configs report_label without going through the rule', () => {
    // The other way to leak it: select the column and read it raw. Only the
    // resolver and the places that carry it as a payload field may name it.
    const CARRIERS = [
      ...REPORT_CARD_FILES,
      // Shapes the admin row and the edit drawer, where the label is being
      // EDITED rather than displayed.
      'lib/sis/subjects/queries.ts',
      'components/sis/subject-catalog-card.tsx',
      'components/sis/subject-config-form.tsx',
      // The write path.
      'app/api/sis/admin/subjects/[configId]/route.ts',
      'lib/schemas/subject-config.ts',
      'lib/sis/subject-config-unchanged.ts',
    ];
    const users = sourceFiles().filter((file) =>
      /\breport_label\b/.test(codeOf(file))
    );
    const strays = users.filter((f) => !CARRIERS.includes(f));
    expect(strays).toEqual([]);
  });
});
