/**
 * THE DIRECTION RULE, for the write-up roster.
 *
 *     A page may be MORE restrictive than its server gate. Never less.
 *
 * `canEditWriteups` decides whether the fields on
 * `/evaluation/sections/[sectionId]` accept typing. Its server counterpart is
 * PATCH `/api/evaluation/writeups`, which admits four roles and then — for a
 * REAL `teacher` only — requires a form-adviser row on the section. The route
 * has NO virtue-theme condition at all, which is why this predicate has always
 * been the stricter of the two.
 *
 * Phase 3c moved it onto the active-role lens, so it is stricter again: a
 * teaching admin looking at the app as a teacher now meets the same locked
 * fields her colleagues do when the term has no virtue theme (KD #28). These
 * tests pin that it only ever moves in that direction.
 */
import { describe, expect, it } from 'vitest';

import { getEntitledRoles } from '@/lib/auth/active-role';
import { ROLES, type Role } from '@/lib/auth/roles';
import { canEditWriteups } from '@/lib/evaluation/edit-gate';

const THEME_STATES = [false, true];

describe('the lens only ever locks fields, never unlocks them', () => {
  it.each(ROLES)(
    '%s: no view can type where the account role could not',
    (role: Role) => {
      for (const viewRole of getEntitledRoles(role, true)) {
        for (const hasVirtueTheme of THEME_STATES) {
          if (canEditWriteups(viewRole, hasVirtueTheme)) {
            expect(
              canEditWriteups(role, hasVirtueTheme),
              `${role} as ${viewRole} (theme=${hasVirtueTheme}) gained the ability to type`
            ).toBe(true);
          }
        }
      }
    }
  );

  it('the identity case is the pre-lens behaviour, unchanged', () => {
    for (const role of ROLES) {
      for (const hasVirtueTheme of THEME_STATES) {
        expect(canEditWriteups(role, hasVirtueTheme)).toBe(
          role !== 'teacher' || hasVirtueTheme
        );
      }
    }
  });

  it('is not vacuous — the Teacher view really does lock a field', () => {
    expect(canEditWriteups('school_admin', false)).toBe(true);
    expect(canEditWriteups('teacher', false)).toBe(false);
  });
});

describe('KD #28 still holds in both views', () => {
  it('a theme unlocks the teacher view', () => {
    expect(canEditWriteups('teacher', true)).toBe(true);
  });

  it('oversight is never blocked by a missing theme — they are the ones who set it', () => {
    for (const role of [
      'academic_coordinator',
      'school_admin',
      'superadmin',
    ] as const) {
      expect(canEditWriteups(role, false)).toBe(true);
    }
  });

  it('nothing changes for a plain teacher — they have no second view', () => {
    expect(getEntitledRoles('teacher', true)).toEqual(['teacher']);
  });
});
