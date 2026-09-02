/**
 * THE MODULE LANDING PAGES RENDER THROUGH THE LENS.
 *
 *        role authorises.  activeRole renders.
 *
 * `__tests__/auth/view-role-call-sites.test.ts` already makes this executable
 * for the two CLASSROOM SCOPE HELPERS, because those take the role as an
 * argument and the argument can be read out of the source. The decisions this
 * file covers have no such helper: they are bare comparisons — `isTeacher`,
 * `isTeacherOnly`, `canToggle`, `canSeeAdmin`, `currentUserId` — written inline
 * on a page, and each one swaps a whole dashboard, a whole section list or a
 * whole toolbar.
 *
 * ⚠ WHY A SOURCE SCAN AND NOT A RENDER TEST. Every file below is an async
 * server component that opens with `await getViewContext()` and then issues
 * five to fifteen Supabase reads before its first element. Rendering one means
 * standing up the whole data layer, and the assertion would be about fixtures
 * rather than about the rule. What actually goes wrong here is textual and
 * silent — somebody writes `role` where `view` belongs, the page compiles, the
 * tests pass, and the Teacher view renders identically to the Admin view. That
 * is the failure this catches, in the place it happens.
 *
 * ⚠ WHAT IT CANNOT SEE, stated so nobody reads it as exhaustive. It checks that
 * the named identifier is DERIVED from the lens, not that every consumer of it
 * behaves. A page could lens `isTeacher` and then branch on `sessionUser.role`
 * three hundred lines later; the "no page decides from the account role"
 * assertion below is what narrows that, and it is per-file rather than global.
 * Same bounded shape as its two sibling guards.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  assertScannableFiles,
  stripComments,
} from '@/__tests__/_utils/strip-comments';

const ROOT = process.cwd();

function source(relativePath: string): string {
  return stripComments(readFileSync(join(ROOT, relativePath), 'utf8'));
}

/**
 * One lensed decision: the file, the binding, and the line that must define it.
 *
 * `mustMatch` is written against the STRIPPED source, so the prose explaining
 * each decision on the page cannot satisfy it.
 */
type LensedDecision = {
  file: string;
  what: string;
  mustMatch: RegExp;
};

const DECISIONS: LensedDecision[] = [
  // ── Attendance ──────────────────────────────────────────────────────────
  {
    file: 'app/(attendance)/attendance/page.tsx',
    what:
      'the branch that swaps the adviser dashboard for the registrar one — ' +
      'the biggest single item in Phase 3c',
    mustMatch: /const view = session\.activeRole \?\? session\.role;/,
  },
  {
    file: 'app/(attendance)/attendance/page.tsx',
    what: 'and the branch itself reads that value',
    mustMatch: /if \(view === 'teacher'\) \{/,
  },
  {
    file: 'app/(attendance)/attendance/sections/page.tsx',
    what:
      '`isTeacherOnly` — the adviser-only section query, the heading, the ' +
      'empty state, the KPI label and `showAdviser`, all at once',
    mustMatch:
      /const isTeacherOnly = \(session\?\.activeRole \?\? role\) === 'teacher';/,
  },

  // ── Evaluation ──────────────────────────────────────────────────────────
  {
    file: 'app/(evaluation)/evaluation/page.tsx',
    what: 'the lens binding the hub branches on',
    mustMatch: /const view = sessionUser\.activeRole \?\? sessionUser\.role;/,
  },
  {
    file: 'app/(evaluation)/evaluation/page.tsx',
    what: '`isTeacher` — her own pending write-ups, the lede, the roster card',
    mustMatch: /const isTeacher = view === 'teacher';/,
  },
  {
    file: 'app/(evaluation)/evaluation/page.tsx',
    what: '`canToggle` — the chase KPIs and the two oversight hub cards',
    mustMatch: /const canToggle =\s*view === 'academic_coordinator'/,
  },
  {
    file: 'app/(evaluation)/evaluation/sections/page.tsx',
    what: 'the adviser-only section filter',
    mustMatch: /if \(view === 'teacher'\) \{\s*const adviserSet =/,
  },
  {
    file: 'app/(evaluation)/evaluation/sections/page.tsx',
    what: 'the adviser-column suppression',
    mustMatch: /view !== 'teacher'\s*\?\s*await loadFormAdvisersBySection/,
  },
  {
    file: 'app/(evaluation)/evaluation/sections/page.tsx',
    what: '`isTeacher` — heading, empty state, KPI label, row destination',
    mustMatch: /const isTeacher = view === 'teacher';/,
  },
  {
    file: 'app/(evaluation)/evaluation/sections/[sectionId]/page.tsx',
    what: 'the per-section adviser filter',
    // ⚠ `activeRole`, not `view`. This page's lens binding is deliberately
    // named for the lens so `view-role-call-sites.test.ts` can classify the
    // `canEditWriteups(…)` call below it — see the note at the binding.
    mustMatch: /if \(activeRole === 'teacher'\) \{\s*const adviserSet =/,
  },
  {
    file: 'app/(evaluation)/evaluation/sections/[sectionId]/page.tsx',
    what: '`canEdit`, through the shared predicate',
    mustMatch: /canEditWriteups\(activeRole, !!config\?\.virtueTheme\)/,
  },

  // ── The report-card roster ──────────────────────────────────────────────
  {
    file: 'app/(markbook)/markbook/report-cards/page.tsx',
    what:
      'the picker, the overview and the roster — the last surface where the ' +
      'Teacher view still showed school-wide data',
    mustMatch: /loadClassroomAccess\(\s*activeRole,/,
  },
  {
    file: 'app/(markbook)/markbook/report-cards/page.tsx',
    what: 'and it scopes on substantiveCapability, matching the detail page',
    mustMatch: /canReadReportCard\(substantiveCapability\)/,
  },

  // ── Markbook ────────────────────────────────────────────────────────────
  {
    file: 'app/(markbook)/markbook/page.tsx',
    what: '`canSeeAdmin` — the whole registrar dashboard and the admin grid',
    mustMatch: /const canSeeAdmin =\s*view === 'academic_coordinator'/,
  },
  {
    file: 'app/(markbook)/markbook/page.tsx',
    what: '`isTeacher` — her own open sheets and the lede over them',
    mustMatch: /const isTeacher = view === 'teacher';/,
  },
  {
    file: 'app/(markbook)/markbook/grading/page.tsx',
    what: '"My sheets" — the line that computed the answer and threw it away',
    mustMatch: /currentUserId=\{view === 'teacher' \? userId : null\}/,
  },
  {
    file: 'app/(markbook)/markbook/grading/page.tsx',
    what: '`canCreate` — "New grading sheet" and "Lock selected"',
    mustMatch: /const canCreate =\s*view === 'academic_coordinator'/,
  },
  {
    file: 'app/(markbook)/markbook/grading/[id]/page.tsx',
    what: 'all five sheet gates, through the shared helper',
    mustMatch: /gradingSheetGates\(\{\s*viewRole: view,/,
  },

  // ── The §3 oversight-control narrowing ──────────────────────────────────
  {
    file: 'app/(attendance)/attendance/[sectionId]/page.tsx',
    what: '`canWriteNc` — the No-class mark',
    mustMatch: /const canWriteNc =\s*viewRole === 'academic_coordinator'/,
  },
  {
    file: 'app/(attendance)/attendance/[sectionId]/page.tsx',
    what: '`canEditAdmin` — the admin roster fields',
    mustMatch:
      /const canEditAdmin =\s*viewRole === 'school_admin' \|\| viewRole === 'superadmin';/,
  },
  {
    file: 'app/(markbook)/markbook/report-cards/[studentId]/page.tsx',
    what: '`canManage` — publication panel, back-link, final-grade box',
    mustMatch: /const canManage =\s*view === 'academic_coordinator'/,
  },
  {
    file: 'app/(markbook)/markbook/sections/page.tsx',
    what: '`canManage` — the "Manage in SIS Admin" button',
    mustMatch: /const canManage =\s*activeRole === 'academic_coordinator'/,
  },
];

describe('the scanner can read what it is given', () => {
  it('every file parses to completion', () => {
    // Over-stripping is silent and would turn every `not.toMatch` below into a
    // free pass. Same check the two sibling guards run on their own scan sets.
    const files = [...new Set(DECISIONS.map((d) => d.file))];
    assertScannableFiles(
      files.map((path) => ({
        path,
        source: readFileSync(join(ROOT, path), 'utf8'),
      }))
    );
  });
});

describe('every module landing decision reads the lens', () => {
  it.each(DECISIONS.map((d) => [`${d.file} — ${d.what}`, d] as const))(
    '%s',
    (_label, decision) => {
      expect(
        source(decision.file),
        `${decision.file} no longer defines ${decision.what} from the ` +
          'active-role lens. A page that decides from the account role renders ' +
          'identically in both views, which is the defect the role switcher ' +
          'exists to remove — and if the shape simply changed, update the ' +
          'pattern here deliberately rather than deleting the row.'
      ).toMatch(decision.mustMatch);
    }
  );
});

describe('the account role is not still deciding underneath', () => {
  // The other direction: a page can lens its headline flag and then leave a
  // second, older branch reading `sessionUser.role`. These four pages have no
  // legitimate reason to compare the account role to a literal any more — the
  // access gates that DO belong on the account role are asserted separately
  // below, and they are somewhere else.
  const NO_ACCOUNT_ROLE_LITERALS = [
    'app/(attendance)/attendance/sections/page.tsx',
    'app/(evaluation)/evaluation/page.tsx',
    'app/(markbook)/markbook/grading/page.tsx',
    'app/(markbook)/markbook/sections/page.tsx',
  ];

  it.each(NO_ACCOUNT_ROLE_LITERALS)(
    '%s compares no account role to a role literal',
    (file) => {
      // Any spelling that reaches the ACCOUNT role and tests it:
      // `sessionUser.role === 'x'`, `session.role !== 'x'`, `view.role === 'x'`
      // — AND the bare `role === 'x'`, which is how three of these four pages
      // hold the account role.
      //
      // ⚠ THE BARE FORM WAS MISSING FROM THE FIRST VERSION OF THIS REGEX, and
      // the omission was caught by demonstrating the guard red: reverting
      // `/markbook/grading`'s "My sheets" line to `role === 'teacher'` failed
      // the pattern check above and sailed straight through here, which is the
      // exact regression this test is second in line to catch.
      const offences = [
        ...source(file).matchAll(
          /(?:\b\w+\.)?\brole\s*[!=]==?\s*'(?:teacher|academic_coordinator|school_admin|superadmin|admissions|p_file_officer)'/g
        ),
      ].map((m) => m[0]);
      expect(offences).toEqual([]);
    }
  );
});

describe('access gates keep the real role — permanently', () => {
  // ⚠ THE OTHER HALF OF THE RULING, AND THE MORE IMPORTANT ONE. Two of the
  // sites Phase 3c touched are role ALLOWLISTS THAT REDIRECT: they decide
  // whether the viewer may be on the page at all, which is authorisation, and
  // authorisation reads the account. Every role a lens can name is already on
  // both lists, so moving them would only ever refuse somebody the account
  // admits — but it would also be a gate reading a cookie, and that is the one
  // thing this whole feature must never do.
  const GATES = [
    'app/(evaluation)/evaluation/sections/page.tsx',
    'app/(evaluation)/evaluation/sections/[sectionId]/page.tsx',
  ];

  it.each(GATES)('%s still redirects on sessionUser.role', (file) => {
    const text = source(file);
    expect(text).toMatch(
      /if \(\s*sessionUser\.role !== 'teacher' &&[\s\S]*?\) \{\s*redirect\('\/'\);/
    );
    // Non-vacuous: the file really does also carry a lensed binding, so this is
    // asserting a SPLIT rather than an unconverted page. Either spelling of
    // that binding counts — the picker page calls it `view`, the detail page
    // calls it `activeRole` because a scope helper reads its name.
    expect(text).toMatch(/const (?:view|activeRole) = sessionUser\.activeRole/);
  });

  it('the report-cards ACCESS gate still reads the account role', () => {
    // The one gate on the page Phase 3c's review newly lensed. `teacher` is not
    // in `ALLOWED_ROLES`, which is exactly why the lensing there has only one
    // audience — the accounts that administer AND teach. Moving this to the
    // lens would lock those accounts out of their own page.
    const text = source('app/(markbook)/markbook/report-cards/page.tsx');
    expect(text).toMatch(
      /!sessionUser\.role \|\| !ALLOWED_ROLES\.has\(sessionUser\.role\)/
    );
    expect(text).toMatch(/const activeRole = sessionUser\.activeRole/);
  });

  it('the admissions layout redirect is untouched — ruled permanent in 3b', () => {
    expect(source('app/(admissions)/layout.tsx')).toMatch(
      /role === 'teacher'[\s\S]{0,40}redirect\('\/markbook'\)/
    );
  });
});
