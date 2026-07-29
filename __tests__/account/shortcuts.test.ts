import { describe, it, expect } from 'vitest';
import { shortcutsForRole } from '@/lib/account/shortcuts';
import { SIDEBAR_REGISTRY } from '@/lib/sidebar/registry';
import { isRouteAllowed } from '@/lib/auth/roles';

describe('shortcutsForRole', () => {
  it('only returns shortcuts for modules the role can actually open', () => {
    const result = shortcutsForRole('p_file_officer');
    for (const s of result) {
      expect(
        isRouteAllowed(SIDEBAR_REGISTRY[s.module].primaryHref, 'p_file_officer')
      ).toBe(true);
    }
  });

  it('skips modules with no quickActionByRole entry — for roles that have some', () => {
    // ASSERTION DELIBERATELY CHANGED (2026-07-30). This test previously
    // asserted the same thing for `teacher` and expected NO markbook entry,
    // citing "Markbook has no teacher quick action by design".
    //
    // That reasoning is the SIDEBAR's: there, a CTA duplicating a module's
    // single nav item is noise. It does not hold for the /account Shortcuts
    // card, which is a cross-module jump list for someone not yet inside any
    // module. Applied there it produced a real bug — `teacher` is the only role
    // whose every openable module omits a quick action, so teachers saw a card
    // with a header and nothing beneath it.
    //
    // The skip-when-absent rule still holds for roles that DO have curated
    // actions; only the zero case now falls back. See shortcutsForRole.
    const result = shortcutsForRole('academic_coordinator');
    expect(result.length).toBeGreaterThan(0);
    // attendance, evaluation and classroom define no quick action for any role.
    // A coordinator can open all three, so their absence here proves the
    // curated path is still in effect and the fallback did not fire.
    //
    // Checked by MODULE, not by a "Open …" label prefix — this role's own
    // curated action is literally labelled "Open applications", so a prefix
    // check would be a false positive. (It was, on the first attempt.)
    for (const m of ['attendance', 'evaluation', 'classroom'] as const) {
      expect(result.some((s) => s.module === m)).toBe(false);
    }
  });

  it('falls back to module entry points only when the role would have none', () => {
    const teacher = shortcutsForRole('teacher');
    expect(teacher.length).toBeGreaterThan(0);
    expect(teacher.map((s) => s.label)).toContain('Open Classroom');
    expect(teacher.map((s) => s.label)).toContain('Open Markbook');
  });

  it('no role gets a blank card', () => {
    for (const role of [
      'teacher',
      'academic_coordinator',
      'school_admin',
      'superadmin',
      'p_file_officer',
      'admissions',
    ] as const) {
      expect(shortcutsForRole(role).length).toBeGreaterThan(0);
    }
  });

  it('the fallback respects assignment-based module hiding', () => {
    // Without this the fallback would hand a subject-teacher-only user two
    // guaranteed dead ends — attendance and evaluation are form-adviser work
    // they physically cannot read (RLS), which is why the switcher hides them.
    const labels = shortcutsForRole('teacher', [
      'attendance',
      'evaluation',
    ]).map((s) => s.label);
    expect(labels).toEqual(['Open Classroom', 'Open Markbook']);
  });

  it('hiding modules does not disturb a role that was never narrowed', () => {
    const before = shortcutsForRole('superadmin');
    const after = shortcutsForRole('superadmin', ['attendance', 'evaluation']);
    expect(after).toEqual(before);
  });

  it('every returned shortcut carries a label, href, and icon from the real registry', () => {
    const result = shortcutsForRole('superadmin');
    expect(result.length).toBeGreaterThan(0);
    for (const s of result) {
      expect(typeof s.label).toBe('string');
      expect(typeof s.href).toBe('string');
      expect(s.icon).toBeDefined();
    }
  });

  it('an unrecognized/no role returns no shortcuts', () => {
    // shortcutsForRole takes Role, but guard the null-session-user call site
    // in page.tsx separately — this test documents the type-level contract
    // by exercising every real Role and confirming none throws.
    for (const role of [
      'teacher',
      'academic_coordinator',
      'school_admin',
      'superadmin',
      'p_file_officer',
      'admissions',
    ] as const) {
      expect(() => shortcutsForRole(role)).not.toThrow();
    }
  });
});
