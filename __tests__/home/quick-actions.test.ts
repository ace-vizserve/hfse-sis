import { describe, it, expect } from 'vitest';
import { getQuickActions, QUICK_ACTIONS } from '@/lib/home/quick-actions';
import { isRouteAllowed, type Role } from '@/lib/auth/roles';
import {
  DEFAULT_ROLE_CAPABILITIES,
  type Capability,
} from '@/lib/auth/capabilities';
import type { TeachingProfile } from '@/lib/sidebar/module-visibility';

const ADVISER: TeachingProfile = { advises: true, teachesSubject: false };
const SUBJECT: TeachingProfile = { advises: false, teachesSubject: true };
const BOTH: TeachingProfile = { advises: true, teachesSubject: true };
const NEITHER: TeachingProfile = { advises: false, teachesSubject: false };

// The real grants, so a role's expected action list is checked against what
// that role actually holds — not against a hand-written literal that could
// drift from DEFAULT_ROLE_CAPABILITIES without anyone noticing.
const CAPS_OF = (role: Role): Capability[] => DEFAULT_ROLE_CAPABILITIES[role];

// A table row carries the filter GROUNDS (`requires`, `requiresCapability`);
// getQuickActions returns only what renders. Comparing a result against the raw
// table therefore needs the same projection getQuickActions applies — this
// still pins every row, in order, it just does it in the returned shape.
const offered = (role: Role) =>
  QUICK_ACTIONS[role].map(({ label, href }) => ({ label, href }));

const ENTER_GRADES = { label: 'Enter grades', href: '/markbook/grading' };
const MARK_ATTENDANCE = {
  label: 'Mark attendance',
  href: '/attendance/sections',
};
const WRITE_EVALUATION = { label: 'Write evaluation', href: '/evaluation' };

// `teacher` is one RBAC role covering two jobs (KD #160), so these cases are
// about the JOB, not the role. The rule that matters: an action is offered only
// to someone who can actually perform it.
describe('getQuickActions — teacher, by job', () => {
  it('offers a form adviser attendance and write-ups, but NOT grades', () => {
    // The bug this replaced: an adviser was offered "Enter grades", which sends
    // them to a fully populated but entirely read-only grid — the write gate is
    // `isSubjectTeacher`, which no form_adviser row satisfies.
    expect(getQuickActions('teacher', [], ADVISER)).toEqual([
      MARK_ATTENDANCE,
      WRITE_EVALUATION,
    ]);
  });

  it('offers a subject teacher grades only', () => {
    expect(getQuickActions('teacher', [], SUBJECT)).toEqual([ENTER_GRADES]);
  });

  it('offers someone who does both jobs all three', () => {
    expect(getQuickActions('teacher', [], BOTH)).toEqual([
      ENTER_GRADES,
      MARK_ATTENDANCE,
      WRITE_EVALUATION,
    ]);
  });

  it('falls back to Classroom for a teacher with no assignments', () => {
    // Every action requires a job, so this viewer matches none — and an empty
    // list renders no buttons at all, leaving a bare header.
    expect(getQuickActions('teacher', [], NEITHER)).toEqual([
      { label: 'Open Classroom', href: '/classroom' },
    ]);
  });

  it('never falls back for an oversight role', () => {
    // A zero-length result there would mean the table itself is wrong; papering
    // over it with a Classroom link would hide that.
    expect(getQuickActions('academic_coordinator', [], NEITHER)).toEqual(
      offered('academic_coordinator')
    );
  });
});

describe('getQuickActions', () => {
  it('returns the 3 school_admin shortcuts', () => {
    // Capabilities are required: the document-validation row is tagged, and
    // getQuickActions fails closed, so omitting them would (correctly) drop it.
    // Passing the REAL defaults is also what proves the tag is a no-op today.
    const actions = getQuickActions(
      'school_admin',
      [],
      NEITHER,
      CAPS_OF('school_admin')
    );
    expect(actions).toEqual([
      {
        label: 'Validate application documents',
        href: '/admissions/document-validation',
      },
      { label: 'AY Setup', href: '/sis/ay-setup' },
      { label: 'Manage staff', href: '/sis/admin/staff' },
    ]);
  });

  it('returns [] for roles that never reach the home page', () => {
    expect(getQuickActions('p_file_officer')).toEqual([]);
    expect(getQuickActions('admissions')).toEqual([]);
  });

  // The regression this file exists to prevent: app/(dashboard)/page.tsx used
  // to call getQuickActions(role) with no hiddenModules on its real render
  // path, so a subject-teacher-only user was offered two dead-end modules
  // while the switcher right above correctly hid them. Nothing here exercised
  // the two-argument form, which is why it shipped.
  it('drops adviser-only modules for a subject-teacher-only teacher', () => {
    const actions = getQuickActions(
      'teacher',
      ['attendance', 'evaluation'],
      SUBJECT
    );
    expect(actions).toEqual([ENTER_GRADES]);
  });

  // The hiddenModules filter is now redundant for teachers — both adviser-only
  // actions also carry `requires: 'adviser'` — but it is kept, and this pins
  // that the two agree rather than fight. A disagreement here would mean one of
  // them is deriving the job differently.
  it('agrees with hiddenModules for an adviser (nothing hidden, all jobs)', () => {
    expect(getQuickActions('teacher', [], BOTH)).toHaveLength(3);
    expect(
      getQuickActions('teacher', ['attendance', 'evaluation'], BOTH)
    ).toEqual([ENTER_GRADES]);
  });

  // Assignment narrowing only ever applies to teachers, so an oversight role's
  // actions must survive even if a caller passed a non-empty hidden list.
  it('does not narrow oversight roles', () => {
    expect(getQuickActions('academic_coordinator', ['attendance'])).toEqual(
      offered('academic_coordinator')
    );
  });

  // Oversight rows carry no `requires`, so the profile must be inert for them
  // — a requirement there would silently strip actions from roles that hold no
  // teaching assignments at all.
  it('ignores the profile for oversight roles', () => {
    for (const profile of [ADVISER, SUBJECT, BOTH, NEITHER]) {
      expect(
        getQuickActions('superadmin', [], profile, CAPS_OF('superadmin'))
      ).toEqual(offered('superadmin'));
    }
  });
});

// The drift this guards against: a row advertising a page whose CAPABILITY
// guard would bounce the viewer. Role alone cannot see that — which is how the
// sidebar came to offer the academic coordinator five links to a page that
// redirected her once migration 106 took `documents_pre_enrolment.read` off her
// (KD #173). Today's rows are all correct; this is what stops the next grant
// move from breaking one silently.
describe('getQuickActions — capability filter', () => {
  it('drops exactly the tagged row when the viewer lacks its capability', () => {
    // Everything school_admin holds EXCEPT the one the document-validation
    // page guards on — the shape a future revoke would produce.
    const without = CAPS_OF('school_admin').filter(
      (c) => c !== 'documents_pre_enrolment.read'
    );

    expect(getQuickActions('school_admin', [], NEITHER, without)).toEqual([
      { label: 'AY Setup', href: '/sis/ay-setup' },
      { label: 'Manage staff', href: '/sis/admin/staff' },
    ]);
  });

  it('keeps the tagged row while the capability is held', () => {
    const actions = getQuickActions(
      'school_admin',
      [],
      NEITHER,
      CAPS_OF('school_admin')
    );
    expect(actions.map((a) => a.href)).toContain(
      '/admissions/document-validation'
    );
  });

  it('fails closed when a caller forgets to pass capabilities', () => {
    // A missing action is visible and gets reported; a dead-end action is the
    // bug this filter exists to prevent. So the default MUST hide, not reveal.
    expect(getQuickActions('superadmin').map((a) => a.href)).not.toContain(
      '/p-files/document-validation'
    );
  });
});

describe('QUICK_ACTIONS table', () => {
  // getQuickActions FILTERS on isRouteAllowed, so a row pointing at a route
  // the role can't open would disappear silently rather than 404 loudly.
  // Assert against the raw table so the failure is visible here instead.
  it('offers every role only routes that role can actually open', () => {
    const offenders: string[] = [];
    for (const [role, actions] of Object.entries(QUICK_ACTIONS)) {
      for (const action of actions) {
        if (!isRouteAllowed(action.href, role as Role)) {
          offenders.push(`${role} -> ${action.href} (${action.label})`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('gives every teacher action an explicit job requirement', () => {
    // A teacher row without one is offered to both jobs — exactly the shape
    // that shipped "Enter grades" to form advisers.
    const missing = QUICK_ACTIONS.teacher.filter((a) => !a.requires);
    expect(missing.map((a) => a.label)).toEqual([]);
  });

  it('gives no NON-teacher action a job requirement', () => {
    const offenders: string[] = [];
    for (const [role, actions] of Object.entries(QUICK_ACTIONS)) {
      if (role === 'teacher') continue;
      for (const a of actions) {
        if (a.requires) offenders.push(`${role} -> ${a.label}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('gives the two document queues distinct labels', () => {
    const schoolAdmin = QUICK_ACTIONS.school_admin[0];
    const superadmin = QUICK_ACTIONS.superadmin[0];
    // Different queues (pre-enrolment validation vs post-enrolment renewals)
    // must not share one label.
    expect(schoolAdmin.href).not.toBe(superadmin.href);
    expect(schoolAdmin.label).not.toBe(superadmin.label);
  });
});
