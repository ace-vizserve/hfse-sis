import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

// EVERY PLACE THAT READS A SUBJECT'S NAME EITHER RESOLVES IT PER YEAR, OR SAYS
// WHY IT DOES NOT.
//
// ── why this test ─────────────────────────────────────────────────────────
//
// The school renamed MAPEH to STAR for AY2026 while AY2025 keeps saying MAPEH.
// The name is therefore a property of the (subject, academic year) pair, and
// `subjects.name` — one row serving every year — cannot express it. Migration
// 137 put the per-year name on `subject_configs.display_name` and
// lib/sis/subjects/display-name.ts holds the one resolution rule.
//
// The failure mode this guards is not a crash. A site that keeps reading
// `subjects.name` renders MAPEH next to a screen rendering STAR, in the same
// year, and nothing anywhere reports a problem. There is no runtime signal at
// all — only a reader noticing that two screens disagree about what a subject
// is called.
//
// So the inventory lives here rather than in a document: re-running it is
// free, and a new raw read fails the build. Each exemption carries a REASON,
// because "correct to leave alone" and "nobody has looked at this" are
// indistinguishable in a bare allowlist.
//
// ⚠ DEMONSTRATED RED BEFORE GREEN, TWICE. Written with both lists empty it
// failed naming 37 files — which is how the inventory below was built, not
// from a grep somebody eyeballed. After the report card and the markbook
// loaders were converted it failed again at 28, proving the walk actually
// re-reads the tree rather than caching a verdict.

/**
 * Every file that could read a subject name — `lib` and all of `app`, `.ts`
 * and `.tsx`.
 *
 * `app` is walked whole rather than just `app/api`: a server component is not
 * an API route but reads the database exactly like one, and several of the
 * hits below are page files. Same reasoning, and the same wording, as the walk
 * in __tests__/cache/write-route-invalidation.test.ts.
 *
 * `components` is walked too. A component cannot query, but it can be handed a
 * subject row and render `.name` off it, and that is where the last mile of a
 * missed conversion shows up on screen.
 */
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

/**
 * Does this file's source ask PostgREST for a subject's `name`?
 *
 * Two shapes, because the codebase uses both:
 *   • embedded  — `subject:subjects(id, code, name)` inside another select
 *   • standalone — `.from('subjects').select('id, code, name')`
 *
 * Deliberately syntactic. A scanner that tried to follow a name through
 * helpers and props would be a type checker, and this is not one — it finds
 * the SOURCE of a name, which is the only place a per-year override can be
 * joined in. See the note on `reads a name it did not fetch` below for the
 * half this cannot see.
 */
export function selectsSubjectName(source: string): boolean {
  const embedded = /(?:[\w]+\s*:\s*)?subjects\s*(?:!\w+\s*)?\(([^()]*)\)/g;
  for (const m of source.matchAll(embedded)) {
    if (/\bname\b/.test(m[1])) return true;
  }

  const standalone =
    /from\(\s*['"]subjects['"]\s*\)[\s\S]{0,400}?\.select\(\s*(['"`])([\s\S]*?)\1/g;
  for (const m of source.matchAll(standalone)) {
    if (/\bname\b/.test(m[2])) return true;
  }

  return false;
}

/** Does the file resolve through the one rule, rather than reading raw? */
function resolvesDisplayName(source: string): boolean {
  return /subjectDisplayName/.test(source);
}

/**
 * ONE walk of the tree, shared by every test below.
 *
 * This scans ~1,400 tracked files. Done per test it took five passes and
 * pushed the file past the default 5s timeout under full-suite load — the
 * exact "passes alone, fails in the suite" shape this repo already has four
 * of, and a guard that looks flaky is a guard people learn to ignore. Memoised
 * here it is one pass, and the timeouts on the tests are explicit rather than
 * hopeful.
 */
let scanCache: {
  readsSubjectName: string[];
  resolved: Set<string>;
} | null = null;

function scan() {
  if (scanCache) return scanCache;
  const readsSubjectName: string[] = [];
  const resolved = new Set<string>();
  for (const file of sourceFiles()) {
    const source = readFileSync(file, 'utf8');
    if (!selectsSubjectName(source)) continue;
    readsSubjectName.push(file);
    if (resolvesDisplayName(source)) resolved.add(file);
  }
  scanCache = { readsSubjectName, resolved };
  return scanCache;
}

/** Generous, because the walk is real I/O and the machine may be busy. */
const SCAN_TIMEOUT = 30_000;

/**
 * A file that reads a subject name WITHOUT resolving it per year, and why that
 * is right.
 *
 * Three reasons recur, and they are not interchangeable:
 *
 *   IDENTITY — the name is being used to identify a subject, not to show one
 *   to a reader: matching, mapping, importing, seeding. `subjects.code` is the
 *   identity and never changes with a rename, so these must NOT resolve. If
 *   one of them started resolving, a rename would silently re-point an import.
 *
 *   HISTORICAL — the name is part of a record of something that already
 *   happened, and the record should keep the words that were used at the time.
 *   An audit row naming a subject as it was called then is not stale; it is
 *   the point of an audit row.
 *
 *   NO YEAR — the surface genuinely has no academic year to resolve against.
 *   The catalogue admin list is the clearest case: it lists the subject rows
 *   themselves, across all years, and the per-year names live one table down.
 */
const RAW_SUBJECT_NAME_IS_CORRECT: Record<string, string> = {
  // ── IDENTITY: the name identifies, it does not display ──────────────────
  'app/api/sis/admin/subjects/catalog/route.ts':
    'CREATES the catalogue row. The name here is the catalogue name being ' +
    'written, and the response echoes what was just stored. There is no ' +
    'academic year in scope to resolve against — a subject is global, which ' +
    'is the whole reason migration 137 exists.',
  'app/api/sis/admin/subjects/catalog/[id]/route.ts':
    'Edits the catalogue row (is_examinable, grading_method, report_label). ' +
    'Same as its sibling above: global fields, no year, and resolving here ' +
    'would show an admin a name their edit is not editing.',
  'app/api/sis/admin/subjects/[configId]/report-map/route.ts':
    'Selects the name but uses only `code` — the audit row records ' +
    'subject_code and report_subject_code. Nothing here reaches a screen.',
  'app/api/sis/admin/subjects/level-offerings/route.ts':
    'Same shape: selects the name, audits `subject_code`. A rename must not ' +
    'change what an audit row says a level offering was attached to.',
  'app/api/sis/admin/subjects/route.ts':
    'Creates the per-AY config row and audits by code, not name.',

  // ── HISTORICAL: the record keeps the words used at the time ─────────────
  'lib/audit/assignment-context.ts':
    'Writes `subject_name` into an audit row describing a teaching ' +
    'assignment change. An audit entry naming the subject as it was called ' +
    'THEN is not stale — that is the job of the table. Resolving it live ' +
    'would rewrite history every time the school renames something, and ' +
    'audit_log is append-only (Hard Rule #6).',

  // ── NO YEAR TO RESOLVE AGAINST, or resolving makes it worse ─────────────
  'lib/markbook/compare.ts':
    'Groups the subject trend BY NAME across academic years. Resolving per ' +
    'year would split MAPEH and STAR into two series in a cross-year ' +
    'comparison — strictly worse than reading one stale name. Fixing it ' +
    'properly means re-keying the trend on subject id and deciding which ' +
    "year's name labels the series, which is a change to compare mode's " +
    'behaviour rather than part of a rename. Measured and left alone.',
};

/**
 * READS THAT SHOULD RESOLVE PER YEAR AND DO NOT YET.
 *
 * Not exemptions. Each of these shows a subject name to a person inside one
 * academic year, so each will read MAPEH on a screen that says STAR until it
 * is converted. They are listed rather than left loose for one reason: the
 * test above must keep failing on anything NEW, and it cannot do that while
 * the known set is unaccounted for.
 *
 * ⚠ THIS LIST IS A CEILING, NOT A BUDGET. The count test below fails if it
 * grows. Converting a file means deleting its line here, not editing it.
 *
 * The two shapes remaining, since neither is hard — only unfinished:
 *   • A `grading_sheets` select. Every sheet points at a subject_config via
 *     subject_config_id, so `subject_config:subject_configs(display_name)`
 *     joins the year's name with no extra query. That is how the grading list
 *     and sheet pages were converted.
 *   • A standalone `subjects` read. Those take
 *     `subjectDisplayNamesForAy(service, ayId, rows)`, one small overlay read.
 */
const NOT_YET_RESOLVED_PER_YEAR: Record<string, string> = {
  'app/(classroom)/classroom/[sectionId]/grades/page.tsx':
    'grading_sheets select — join subject_config:subject_configs(display_name).',
  'app/(markbook)/markbook/change-requests/page.tsx':
    'grading_sheets select behind the change-request list.',
  'app/(markbook)/markbook/grading/requests/page.tsx':
    'same list, teacher-facing half.',
  'app/(sis)/sis/sections/[id]/page.tsx':
    'section_subjects select — the config is already the row being walked.',
  'app/api/grading-sheets/[id]/route.ts':
    'already embeds subject_config; needs display_name plus a consumer that ' +
    'reads it.',
  'app/api/grading-sheets/route.ts': 'grading_sheets list select.',
  'app/api/grading-sheets/bulk-create/preview/route.ts':
    'selects FROM subject_configs already — one field away.',
  'app/api/sections/[id]/subjects/route.ts':
    'selects FROM subject_configs already — one field away.',
  'app/api/sections/[id]/subjects/attach-many/route.ts': 'same shape.',
  'app/api/sections/[id]/subjects/[subjectConfigId]/route.ts': 'same shape.',
  'app/api/teacher-assignments/route.ts':
    'builds a subject-name map for assignment labels; needs the AY overlay.',
  'app/api/teacher-assignments/by-teacher/route.ts': 'same map, per teacher.',
  'lib/account/sections.ts':
    "the account page's list of what a teacher teaches.",
  'lib/change-requests/labels.ts':
    'builds the "P4 Diligence · MAPEH · Term 1" label shown in the ' +
    'change-request queue and its emails. AY-scoped through the sheet.',
  'lib/home/todos.ts': 'home-page to-do labels.',
  'lib/relief/cover-board.ts': 'the cover board names the subject covered.',
  'lib/relief/upcoming.ts': 'the "You\'re covering" panel.',
  'lib/sis/records-history.ts': "a student's academic history rows.",
  'lib/sis/staff.ts': 'the staff directory lists what each teacher teaches.',
  'lib/sis/teacher-detail.ts': 'the teacher page, same list.',
};

describe('every subject-name read is resolved per academic year', () => {
  it(
    'has no unreviewed raw reads',
    () => {
      const { readsSubjectName, resolved } = scan();
      const offenders = readsSubjectName.filter(
        (file) =>
          !resolved.has(file) &&
          !(file in RAW_SUBJECT_NAME_IS_CORRECT) &&
          !(file in NOT_YET_RESOLVED_PER_YEAR)
      );
      expect(offenders).toEqual([]);
    },
    SCAN_TIMEOUT
  );

  it('the unconverted list only ever shrinks', () => {
    // A ceiling, not a budget. 20 as of 2026-08-31, after the report card,
    // the markbook loaders, the grading pages and the classroom panels were
    // converted. If this number needs to go UP, something was written raw
    // that should have resolved — convert it instead of raising the cap.
    expect(Object.keys(NOT_YET_RESOLVED_PER_YEAR).length).toBeLessThanOrEqual(
      20
    );
  });

  it('nothing is on both lists', () => {
    // "Correct as it is" and "not done yet" are opposite claims. A file
    // holding both is a classification nobody has actually made.
    const both = Object.keys(RAW_SUBJECT_NAME_IS_CORRECT).filter(
      (f) => f in NOT_YET_RESOLVED_PER_YEAR
    );
    expect(both).toEqual([]);
  });

  it(
    'no unconverted entry has quietly been converted already',
    () => {
      // The mirror of the stale-exemption check below: a file that now
      // resolves should be off this list, or the count above stops meaning
      // anything.
      const { resolved } = scan();
      const done = Object.keys(NOT_YET_RESOLVED_PER_YEAR).filter((file) =>
        resolved.has(file)
      );
      expect(done).toEqual([]);
    },
    SCAN_TIMEOUT
  );

  it(
    'has no stale exemptions — every exempt file still reads a subject name',
    () => {
      // An exemption that no longer describes anything is worse than none: it
      // reads as "reviewed and fine" over code that has moved on.
      const stillReads = new Set(scan().readsSubjectName);
      const stale = Object.keys(RAW_SUBJECT_NAME_IS_CORRECT).filter(
        (file) => !stillReads.has(file)
      );
      expect(stale).toEqual([]);
    },
    SCAN_TIMEOUT
  );

  it('every exemption gives a reason', () => {
    const empty = Object.entries(RAW_SUBJECT_NAME_IS_CORRECT)
      .filter(([, reason]) => reason.trim().length < 20)
      .map(([file]) => file);
    expect(empty).toEqual([]);
  });
});

describe('the scanner itself', () => {
  it('sees an embedded subject select', () => {
    expect(
      selectsSubjectName("select('id, subject:subjects(id, code, name)')")
    ).toBe(true);
  });

  it('sees a standalone subjects select', () => {
    expect(
      selectsSubjectName("from('subjects').select('id, code, name')")
    ).toBe(true);
  });

  it('ignores a subject select that does not ask for the name', () => {
    expect(selectsSubjectName("select('id, subject:subjects(id, code)')")).toBe(
      false
    );
  });

  it('does not fire on the word name elsewhere in a file', () => {
    expect(selectsSubjectName('const name = student.full_name;')).toBe(false);
  });
});
