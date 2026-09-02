/**
 * Anyone on staff can be given a class — the surfaces that have to agree.
 *
 * The two write gates are exercised for real in
 * `teacher-assignment-bulk-create.test.ts` and `assignment-relief-switch.test.ts`.
 * What THIS file pins is the half that has no runtime seam: which list each
 * PICKER is built from, and which rows the Accounts table offers the
 * assignment action on.
 *
 * A picker narrower than its route is not a small mismatch. It is the whole
 * defect this phase exists to fix: six school_admin accounts already hold
 * AY2026 teaching assignments — four of them as the form adviser of record,
 * whose FCA write-ups hard-gate report-card publishing (KD #138 / #145) — and
 * because the pickers listed teachers only, a co-teacher change on one of
 * those classes could not be made in the app at all. Those rows were written
 * straight to the database by the deployment import.
 *
 * A picker WIDER than its route is the opposite failure and just as real: it
 * would offer names that come back as a 400.
 *
 * These are source greps, deliberately. Every surface below is a server
 * component or a client table whose behaviour here is a single conditional;
 * rendering them to assert "this list came from that helper" would test the
 * mock, not the wiring.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

/** Source with comments stripped — the assertions are about what the file
 *  CALLS, and the comments in these files naturally name both helpers. */
const source = (rel: string) =>
  readFileSync(join(ROOT, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');

/**
 * Every surface that decides WHO MAY BE RECORDED AS TEACHING — the two write
 * gates, the relief gate that sits between them, and each picker that feeds
 * one of the three.
 */
const ASSIGNABLE_SURFACES: Array<[label: string, path: string]> = [
  ['POST /api/teacher-assignments', 'app/api/teacher-assignments/route.ts'],
  [
    'PATCH /api/teacher-assignments/[id] (cover for one class)',
    'app/api/teacher-assignments/[id]/route.ts',
  ],
  [
    'POST /api/relief/book (cover for a whole absence)',
    'app/api/relief/book/route.ts',
  ],
  [
    'GET /api/users/teachers (the Teachers tab refresh)',
    'app/api/users/teachers/route.ts',
  ],
  ['the section Teachers tab', 'app/(sis)/sis/sections/[id]/page.tsx'],
  ['the Cover board', 'app/(sis)/sis/admin/cover/page.tsx'],
  [
    "a teacher's own page (its relief picker)",
    'app/(sis)/sis/admin/staff/[teacherId]/page.tsx',
  ],
  [
    'the new grading sheet form',
    'app/(markbook)/markbook/grading/new/page.tsx',
  ],
  ['the grading sheets list', 'app/(markbook)/markbook/grading/page.tsx'],
];

describe('the surfaces that decide who may be recorded as teaching', () => {
  it.each(ASSIGNABLE_SURFACES)(
    '%s reads getAssignableStaffList, not getTeacherList',
    (_label, path) => {
      const code = source(path);
      expect(code).toContain('getAssignableStaffList');
      expect(code).not.toContain('getTeacherList');
    }
  );

  it.each(ASSIGNABLE_SURFACES)(
    '%s never reaches for getStaffDisplayNameById',
    (_label, path) => {
      // THE SECURITY PROPERTY, ONCE PER SURFACE. That helper returns every
      // auth user with an email, which on this project is ~1,000 parent portal
      // accounts (KD #1). `teacher_assignments` declares no FK to auth.users,
      // so a parent uuid written there is accepted, and the RLS helpers in
      // migrations 005 and 117 then hand that parent read on the class's
      // students and their grades. Widening from teachers to staff changed
      // which ROLES are allowed; it did not change this.
      expect(source(path)).not.toContain('getStaffDisplayNameById');
    }
  );

  it('the two write gates say "staff account", not "teacher account"', () => {
    // The old message stated a rule that no longer exists, and it is read by a
    // school administrator, not a developer.
    const post = source('app/api/teacher-assignments/route.ts');
    expect(post).toContain('staff account');
    expect(post).not.toContain('teacher account');

    for (const path of [
      'app/api/relief/book/route.ts',
      'app/api/teacher-assignments/[id]/route.ts',
    ]) {
      const code = source(path);
      expect(code).toContain('member of staff with an active account');
      expect(code).not.toContain('Choose a teacher with an active account');
    }
  });

  it('none of the three tells the reader to refresh the list', () => {
    // The list all three read is cached on the SERVER for five minutes and
    // shared by everyone, so a refresh in the browser cannot change the
    // answer. The POST route has explained this at length since it was
    // written and dropped the instruction from its own message; the two relief
    // gates were still giving it. Telling an admin to do something that cannot
    // work is worse than telling them nothing.
    for (const path of [
      'app/api/teacher-assignments/route.ts',
      'app/api/relief/book/route.ts',
      'app/api/teacher-assignments/[id]/route.ts',
    ]) {
      expect(source(path)).not.toContain('Refresh the list and try again');
      expect(source(path)).toContain(
        'Check that person on the Staff page, then try again.'
      );
    }
  });
});

describe('the surfaces that only resolve a NAME', () => {
  // A different job from the gates above, and it fails differently: both of
  // these drop any id they cannot name, so a narrow list does not refuse
  // anything, it just renders a blank where a person should be. That is how the
  // school_admin form advisers came to show as "no adviser" on six screens.
  //
  // Whoever HOLDS a class is the name of record whether or not they can sign in
  // today, so a name lookup must not exclude disabled accounts either.
  it.each([
    ['the form adviser of each section', 'lib/sis/staff.ts'],
    ['the grading sheets list', 'app/(markbook)/markbook/grading/page.tsx'],
  ])('%s asks for disabled accounts too', (_label, path) => {
    expect(source(path)).toContain(
      'getAssignableStaffList({ excludeDisabled: false })'
    );
  });
});

describe('the Accounts table', () => {
  const path = 'components/sis/staff-accounts-client.tsx';

  it('offers "Manage teaching assignments" on every staff row', () => {
    // This row action opens the assignment sheet for the person in the row,
    // and it is the one place in the app the six existing school_admin
    // assignments can be maintained. It used to be wrapped in
    // `row.original.role === 'teacher' && …`.
    //
    // ⚠ The role read here is the ROW's — the person being listed — not the
    // viewer's. It is not a lens site and the lens must never be applied to it.
    //
    // Scoped to `row.original.role` rather than any mention of the literal:
    // the create-account dialog further down this file still keys its "Now
    // assign their classes →" toast action on the role the account was just
    // GIVEN, which is a nudge on the creation path and not a gate on anything.
    const code = source(path);
    expect(code).toContain('Manage teaching assignments');
    expect(code).not.toContain("row.original.role === 'teacher'");
  });

  it('does not gate the Assignments column on the row being a teacher either', () => {
    // It keys on whether this page HAS teaching data for the row. That still
    // shows a dash for most non-teacher staff, because the roster behind it
    // (`loadStaffAssignments`) is teacher-only — a known gap, recorded above
    // `loadStaffAssignmentsUncached` in lib/sis/staff.ts. A dash means "not
    // shown here"; printing "No assignments" for a school_admin who advises a
    // form class would be a statement, and a false one.
    expect(source(path)).not.toContain("row.role !== 'teacher'");
  });
});

describe('getTeacherList is left alone', () => {
  it('still means role === teacher', () => {
    // The sibling was added, not a widening. Several surfaces genuinely do ask
    // "whose job is teaching?" — the "N teaching" headcount chip, the
    // Assignments cut's roster — and re-pointing those would change what those
    // pages SAY rather than what they permit.
    const code = source('lib/auth/staff-list.ts');
    expect(code).toContain("u.role === 'teacher'");
    expect(code).toContain('export async function getTeacherList');
  });

  it('and the surfaces that mean "whose job is teaching" still use it', () => {
    for (const path of [
      // "{N} teaching staff" and "{N} people · {N} teaching".
      'app/(sis)/sis/admin/staff/page.tsx',
      'components/sis/staff-directory-chrome.tsx',
      // The Assignments cut's roster, which prints a role="teacher" chip on
      // every row it returns.
      'lib/sis/staff.ts',
    ]) {
      expect(source(path)).toContain('getTeacherList');
    }
  });
});
