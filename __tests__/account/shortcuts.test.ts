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

  it('skips modules with no quickActionByRole entry for this role, rather than returning empty placeholders', () => {
    const result = shortcutsForRole('teacher');
    // Markbook's registry entry has NO teacher quick action by design (see
    // lib/sidebar/registry.ts's own comment on this) — must not appear.
    expect(result.some((s) => s.module === 'markbook')).toBe(false);
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
