/**
 * "Active" has two spellings, and forgetting the second one is silent.
 *
 * `enrollment_status` conflates two independent facts in one column: whether a
 * student is enrolled (active vs withdrawn) and whether they joined after the
 * year started (late_enrollee). But a late enrollee IS an active student —
 * "late" is a property of their tenure, carried by `enrollment_date`, which is
 * why KD #146 can flip the label back to `active` with byte-identical
 * attendance rollups.
 *
 * So any query that means "students on this roster" must match BOTH values, and
 * one that writes `.eq('enrollment_status', 'active')` simply returns fewer
 * students with no error. That has now happened at least three times:
 *
 *   • the section capacity check counted only `active`, so late enrollees didn't
 *     count toward the 50-student cap (Hard Rule #5) — 13 of 21 AY2026 sections
 *     were mis-counted, with 20 late enrollees live in the AY
 *   • KD #126: a submission KPI used `.eq('active')` while its own drill used
 *     `.neq('withdrawn')`, so card and drill disagreed
 *   • lib/sis/drill.ts's own comment records a third instance dropping "every
 *     late enrollee from drill results, producing card-vs-drill mismatches"
 *
 * A unit test of the predicate alone would not have caught any of them — the
 * bug is always at a call site. Hence the source sweep below.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  ENROLLED_STATUSES,
  isEnrolledStatus,
  ENROLLMENT_STATUS_VALUES,
} from '@/lib/schemas/enrolment';

describe('ENROLLED_STATUSES / isEnrolledStatus', () => {
  it('includes late_enrollee — the whole point', () => {
    expect([...ENROLLED_STATUSES]).toContain('active');
    expect([...ENROLLED_STATUSES]).toContain('late_enrollee');
  });

  it('excludes withdrawn, and nothing else', () => {
    const excluded = ENROLLMENT_STATUS_VALUES.filter(
      (v) => !(ENROLLED_STATUSES as readonly string[]).includes(v)
    );
    expect(excluded).toEqual(['withdrawn']);
  });

  it('stays in sync with the enum — a new status must be classified', () => {
    // If someone adds e.g. 'graduated' to ENROLLMENT_STATUS_VALUES, this fails
    // and forces a decision about whether it counts as on-roster, rather than
    // letting it default to "not enrolled" by omission.
    expect(ENROLLMENT_STATUS_VALUES).toHaveLength(3);
  });

  it('isEnrolledStatus agrees with the list', () => {
    for (const v of ENROLLMENT_STATUS_VALUES) {
      expect(isEnrolledStatus(v)).toBe(
        (ENROLLED_STATUSES as readonly string[]).includes(v)
      );
    }
  });

  it('isEnrolledStatus is safe on null/undefined/garbage', () => {
    expect(isEnrolledStatus(null)).toBe(false);
    expect(isEnrolledStatus(undefined)).toBe(false);
    expect(isEnrolledStatus('')).toBe(false);
    expect(isEnrolledStatus('Active')).toBe(false); // case-sensitive by design
  });
});

// ─── source sweep ──────────────────────────────────────────────────────────
//
// Read as text rather than imported, same technique as
// __tests__/audit/allowlist-coverage.test.ts (these are RSC/route modules that
// can't be imported as plain modules).

const ROOTS = ['lib', 'app'];

/**
 * Sites where `.eq('enrollment_status', 'active')` is CORRECT and must stay.
 * Each is exempt for a specific reason, not because it was inconvenient:
 *
 *  - seeder/demo-extras.ts  picks ACTIVE rows to flip INTO late/withdrawn; if it
 *                           matched late rows it would re-flip its own output.
 *  - seeder/edge-cases.ts   uses it as an optimistic claim guard on an UPDATE
 *                           ("only withdraw a row that is still active"), and to
 *                           detect whether a transfer already created an active
 *                           row in the target.
 *
 * Both are test-environment seeders. If you add to this list, say why here.
 */
const EXEMPT = [
  path.join('lib', 'sis', 'seeder', 'demo-extras.ts'),
  path.join('lib', 'sis', 'seeder', 'edge-cases.ts'),
];

/**
 * Strip comments before matching.
 *
 * Necessary, not fastidious: the fix in lib/sis/class-assignment.ts documents
 * the old filter verbatim in a comment ("This used `.eq('enrollment_status',
 * 'active')` …"), and the first version of this test flagged that file for its
 * own explanation. A guard that punishes you for describing the bug you fixed
 * teaches people to stop writing the explanation.
 */
// 🔴 THE LOCAL TWO-REGEX STRIPPER IS GONE — same defect as every other guard
// in this repo carried, and unsafe here for the same reason: this test asserts
// ABSENCE, so source the stripper wrongly deletes is a silent PASS, and what
// slips through is a reader that drops late enrollees.
//
// It stripped `/* … */` before `// …`, so a `/*` inside a LINE comment opened
// a block comment that ran to the next `*/`, deleting everything between.
//
// ⚠ ITS `(^|[^:])\/\/` RULE — sparing `://` in URLs — is NOT lost, it is
// subsumed. That regex existed to stop a URL inside a string being read as a
// comment; the one-pass scanner tracks string literals properly, so a URL in a
// string is never a comment start in the first place, and a bare `//` in code
// still is. Strictly wider coverage, not a trade.
import {
  assertScannableFiles,
  stripComments,
} from '@/__tests__/_utils/strip-comments';

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('no production reader silently drops late enrollees', () => {
  it("does not use .eq('enrollment_status', 'active') outside the exempt seeders", () => {
    const offenders: string[] = [];

    for (const root of ROOTS) {
      const dir = path.join(process.cwd(), root);
      if (!fs.existsSync(dir)) continue;
      for (const file of walk(dir)) {
        const rel = path.relative(process.cwd(), file);
        if (EXEMPT.some((e) => rel.endsWith(e))) continue;
        const src = stripComments(fs.readFileSync(file, 'utf8'));
        // Match the equality filter in either quote style, ignoring whitespace.
        if (
          /\.eq\(\s*['"]enrollment_status['"]\s*,\s*['"]active['"]\s*\)/.test(
            src
          )
        ) {
          offenders.push(rel);
        }
      }
    }

    expect(
      offenders,
      `These filter enrollment_status to 'active' only, which silently excludes ` +
        `late enrollees. Use ENROLLED_STATUSES with .in(...) — or add the file to ` +
        `EXEMPT above with a reason if active-only is genuinely intended.`
    ).toEqual([]);
  });

  it('the scanner read every file that mentions enrollment_status', () => {
    // The vacuity check this guard never had. A file the scanner desyncs on
    // has its tail dropped before the offender pattern is ever matched
    // against it — so an `.eq('enrollment_status', 'active')` sitting below
    // the desync point simply is not there, and the guard passes.
    //
    // ⚠ Scoped to files that mention the column, not to the whole walk. Six
    // files in this repo desync today and not one of them mentions
    // `enrollment_status` (four on a regex literal containing a quote, two on
    // an apostrophe in JSX prose — listed in
    // `__tests__/auth/assignment-read-classification.test.ts`). Asserting over
    // the whole walk would fail this guard for reasons unrelated to what it
    // protects, which is how guards end up deleted rather than fixed.
    //
    // ⚠ THE SIBLING GUARD SCOPES BY ITS PATTERN LIST, NOT BY A SUBSTRING, AND
    // THE DIFFERENCE IS DELIBERATE RATHER THAN AN INCONSISTENCY.
    // `assignment-read-classification` polices a dozen HELPER NAMES
    // (`loadClassroomAccess`, `resolveClassroomScope`, …), so a file can reach
    // `teacher_assignments` without ever containing that string — a substring
    // scope there missed 32 real files. This guard's offender pattern is
    // `.eq('enrollment_status', 'active')`, which cannot be written without
    // the column name in it, so substring and pattern-match select exactly the
    // same files. Raw substring is the simpler spelling of the identical set,
    // and it is only correct HERE because of that property.
    const candidates: Array<{ path: string; source: string }> = [];
    for (const root of ROOTS) {
      const dir = path.join(process.cwd(), root);
      if (!fs.existsSync(dir)) continue;
      for (const file of walk(dir)) {
        const source = fs.readFileSync(file, 'utf8');
        if (source.includes('enrollment_status')) {
          candidates.push({
            path: path.relative(process.cwd(), file).split(path.sep).join('/'),
            source,
          });
        }
      }
    }
    expect(candidates.length).toBeGreaterThan(10);
    assertScannableFiles(candidates);
  });
});
