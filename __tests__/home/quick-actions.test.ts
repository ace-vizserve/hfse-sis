import { describe, it, expect } from 'vitest';
import { getQuickActions, QUICK_ACTIONS } from '@/lib/home/quick-actions';
import { isRouteAllowed, type Role } from '@/lib/auth/roles';

describe('getQuickActions', () => {
  it('returns the 3 teacher shortcuts', () => {
    const actions = getQuickActions('teacher');
    expect(actions).toEqual([
      { label: 'Enter grades', href: '/markbook/grading' },
      { label: 'Mark attendance', href: '/attendance/sections' },
      { label: 'Write evaluation', href: '/evaluation' },
    ]);
  });

  it('returns the 3 school_admin shortcuts', () => {
    const actions = getQuickActions('school_admin');
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
    const actions = getQuickActions('teacher', ['attendance', 'evaluation']);
    expect(actions).toEqual([
      { label: 'Enter grades', href: '/markbook/grading' },
    ]);
  });

  it('leaves a form adviser all 3 actions (nothing hidden)', () => {
    expect(getQuickActions('teacher', [])).toHaveLength(3);
  });

  // Assignment narrowing only ever applies to teachers, so an oversight role's
  // actions must survive even if a caller passed a non-empty hidden list.
  it('does not narrow oversight roles', () => {
    expect(getQuickActions('academic_coordinator', ['attendance'])).toEqual(
      QUICK_ACTIONS.academic_coordinator
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

  it('gives the two document queues distinct labels', () => {
    const schoolAdmin = QUICK_ACTIONS.school_admin[0];
    const superadmin = QUICK_ACTIONS.superadmin[0];
    // Different queues (pre-enrolment validation vs post-enrolment renewals)
    // must not share one label.
    expect(schoolAdmin.href).not.toBe(superadmin.href);
    expect(schoolAdmin.label).not.toBe(superadmin.label);
  });
});
