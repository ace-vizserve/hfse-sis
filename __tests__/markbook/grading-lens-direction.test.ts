/**
 * THE DIRECTION RULE, for the grading sheet.
 *
 *     A page may be MORE restrictive than its server gate. Never less.
 *
 * A page that is more permissive than the route behind it is editable inputs
 * and a 403 on save — a defect this codebase has shipped before, which is why
 * `readOnly` on `/markbook/grading/[id]` carries a comment saying it mirrors
 * PATCH `/api/grading-sheets/[id]/entries/[entryId]`.
 *
 * Phase 3c put the active-role lens through the five flags on that page, so the
 * mirror is no longer exact: for a teaching admin in the Teacher view the page
 * now refuses things the route would still accept. That asymmetry is the safe
 * one, and it is what these tests pin.
 *
 * ⚠ HOW THE ROUTE IS MODELLED, AND WHY IT IS NOT MODELLED IN DETAIL. The route
 * decides on the REAL JWT role, which the lens cannot touch — its answer is
 * therefore a CONSTANT with respect to the view. So the property that has to
 * hold is monotonicity: switching to a lens must never turn a refusal into a
 * permission. Given that the page already agreed with the route before the lens
 * existed (which it did — that is the pre-Phase-3 behaviour, reproduced here as
 * the identity case), monotonicity is exactly "the page never becomes more
 * permissive than the route". Modelling the route's own body would mean
 * copying it into a test, where it could drift; this way there is nothing to
 * drift.
 *
 * ⚠ AND THE PREMISE IS CHECKED, NOT ASSUMED — that was a gap in the first
 * version of this file, which proved the page could not become more permissive
 * than ITSELF and then argued the rest. The missing leg lives in
 * `__tests__/markbook/grade-entry-subject-teacher-gate.test.ts`, whose final
 * suite drives the REAL handler with an oversight role and shows it accepts
 * exactly the requests the Teacher view refuses — on an unlocked sheet with no
 * assignment, and on a locked one. Read the two files together; neither is the
 * whole argument on its own.
 */
import { describe, expect, it } from 'vitest';

import { getEntitledRoles } from '@/lib/auth/active-role';
import { isRouteAllowed, ROLES, type Role } from '@/lib/auth/roles';
import {
  gradingSheetGates,
  type GradingSheetGates,
} from '@/lib/markbook/grading-gates';

const LOCK_STATES = [false, true];
const ASSIGNMENT_STATES = [false, true];

/**
 * The roles that can actually open a grading sheet.
 *
 * ⚠ NOT every role, and the exclusion is deliberate rather than convenient.
 * `getEntitledRoles` hands a `'teacher'` lens to ANY non-teacher account that
 * holds assignment rows, so on paper an `admissions` officer could have one —
 * and for that pairing the monotonicity check below genuinely fails, because
 * the identity case (`admissions` reading a grading sheet) is a state nobody
 * ever designed: `ROUTE_ACCESS` refuses `admissions` and `p_file_officer` at
 * `/markbook` outright, so `gradingSheetGates` has never been asked about them
 * and its answer for them is arbitrary rather than wrong.
 *
 * Asserting over states the app cannot produce would make this test fail for a
 * reason that is not about the lens. Derived from `isRouteAllowed` rather than
 * listed, so a change to who may enter Markbook changes this set with it.
 */
const CAN_OPEN_A_SHEET: Role[] = ROLES.filter((r) =>
  isRouteAllowed('/markbook/grading', r)
);

/** Every input combination, for one (role, view) pair. */
function* cases() {
  for (const isLocked of LOCK_STATES) {
    for (const isSubjectTeacherForSheet of ASSIGNMENT_STATES) {
      yield { isLocked, isSubjectTeacherForSheet };
    }
  }
}

/**
 * The permissions a set of gates GRANTS, named as the action rather than the
 * flag — because `isAssignedTeacher` on its own is not a permission (it also
 * turns the monitoring banner ON, which is a restriction).
 *
 * ⚠ `canFileChangeRequest` IS DELIBERATELY NOT IN HERE, and that is a finding
 * rather than a convenience. The Teacher view genuinely GAINS it: on a locked
 * sheet an admin normally edits directly (`canManage` bypasses the lock and
 * prompts for an approval reference), and in the Teacher view she loses that
 * and is offered "Request edit" instead. It is a substitution, not a widening —
 * she can still change the number, by the route her colleagues use.
 *
 * And it does not break the rule this file is about, which is about the SERVER
 * gate rather than about the other view: `POST /api/change-requests` admits
 * `['teacher', 'academic_coordinator', 'school_admin', 'superadmin']` and its
 * own comment says "school_admin+ can also file one (shouldn't need to, but not
 * blocked)". So the button the Teacher view draws is a button the route will
 * honour. Asserted separately below rather than silently excluded.
 */
function granted(g: GradingSheetGates, isLocked: boolean) {
  return {
    canEnterScores: !g.readOnly,
    canManage: g.canManage,
    canEditSlotLabels: (g.isAssignedTeacher && !isLocked) || g.canManage,
  };
}

/** The "Request edit" button on a locked sheet. */
function canFileChangeRequest(g: GradingSheetGates, isLocked: boolean) {
  return isLocked && g.isAssignedTeacher;
}

describe('the lens only ever takes editing away', () => {
  it.each(CAN_OPEN_A_SHEET)(
    '%s: no view grants anything the account role does not already have',
    (role: Role) => {
      for (const viewRole of getEntitledRoles(role, true)) {
        for (const input of cases()) {
          const own = granted(
            gradingSheetGates({ viewRole: role, ...input }),
            input.isLocked
          );
          const lensed = granted(
            gradingSheetGates({ viewRole, ...input }),
            input.isLocked
          );

          for (const key of Object.keys(own) as (keyof typeof own)[]) {
            if (lensed[key]) {
              expect(
                own[key],
                `${role} as ${viewRole} (locked=${input.isLocked}, ` +
                  `assigned=${input.isSubjectTeacherForSheet}) gained "${key}"`
              ).toBe(true);
            }
          }
        }
      }
    }
  );

  it('the identity case is unchanged — the view IS the account role', () => {
    // The pre-lens behaviour, reproduced. This is the leg the monotonicity
    // argument above stands on: if the page still answers exactly as it did
    // when only `role` existed, then "never wider than the identity case" is
    // the same statement as "never wider than the route".
    for (const role of ROLES) {
      for (const input of cases()) {
        const gates = gradingSheetGates({ viewRole: role, ...input });
        const isOversight =
          role === 'academic_coordinator' ||
          role === 'school_admin' ||
          role === 'superadmin';
        expect(gates.canManage).toBe(isOversight);
        expect(gates.readOnly).toBe(
          (input.isLocked && !isOversight) ||
            (role === 'teacher' && !input.isSubjectTeacherForSheet)
        );
      }
    }
  });

  it('the one thing the Teacher view ADDS is a route the server accepts', () => {
    // A teaching admin on a locked sheet she teaches. In the Admin view she
    // edits it directly; in the Teacher view she files a change request. Both
    // are accepted by their routes — see the note on `canFileChangeRequest`.
    const input = { isLocked: true, isSubjectTeacherForSheet: true };
    expect(
      canFileChangeRequest(
        gradingSheetGates({ viewRole: 'school_admin', ...input }),
        true
      )
    ).toBe(false);
    expect(
      canFileChangeRequest(
        gradingSheetGates({ viewRole: 'teacher', ...input }),
        true
      )
    ).toBe(true);
    // And she has not been stranded: what she loses is the direct edit, which
    // the request flow replaces.
    expect(
      gradingSheetGates({ viewRole: 'school_admin', ...input }).readOnly
    ).toBe(false);
    expect(gradingSheetGates({ viewRole: 'teacher', ...input }).readOnly).toBe(
      true
    );
  });

  it('is not vacuous — the Teacher view really does remove something', () => {
    // A teaching admin on a locked sheet she does not teach.
    const admin = gradingSheetGates({
      viewRole: 'school_admin',
      isLocked: true,
      isSubjectTeacherForSheet: false,
    });
    const asTeacher = gradingSheetGates({
      viewRole: 'teacher',
      isLocked: true,
      isSubjectTeacherForSheet: false,
    });
    expect(admin.readOnly).toBe(false);
    expect(asTeacher.readOnly).toBe(true);
    expect(admin.canManage).toBe(true);
    expect(asTeacher.canManage).toBe(false);
  });
});

describe('the flags agree with each other', () => {
  it('never claims "monitoring only" over an editable grid', () => {
    // `:356 ↔ :349` in the Phase 3c brief. `isMonitoringOnly` is the banner
    // that EXPLAINS a dead grid; printing it beside live inputs would be a
    // contradiction on screen.
    for (const role of ROLES) {
      for (const viewRole of getEntitledRoles(role, true)) {
        for (const input of cases()) {
          const g = gradingSheetGates({ viewRole, ...input });
          if (g.isMonitoringOnly) {
            expect(
              g.readOnly,
              `${role} as ${viewRole}: monitoring-only banner over an editable grid`
            ).toBe(true);
          }
        }
      }
    }
  });

  it('never asks for an approval reference on a grid nobody can type in', () => {
    // `requireApproval` is what makes a save prompt for the Hard Rule #5
    // reference. It is meaningless — and confusing — on a read-only grid.
    for (const role of ROLES) {
      for (const viewRole of getEntitledRoles(role, true)) {
        for (const input of cases()) {
          const g = gradingSheetGates({ viewRole, ...input });
          if (g.requireApproval) expect(g.readOnly).toBe(false);
        }
      }
    }
  });

  it('a locked sheet is editable only under the approval flow', () => {
    for (const role of ROLES) {
      for (const viewRole of getEntitledRoles(role, true)) {
        const g = gradingSheetGates({
          viewRole,
          isLocked: true,
          isSubjectTeacherForSheet: true,
        });
        if (!g.readOnly) expect(g.requireApproval).toBe(true);
      }
    }
  });
});

describe('nothing changes for a plain teacher', () => {
  it('the entitled set is exactly ["teacher"], so there is no second answer', () => {
    expect(getEntitledRoles('teacher', true)).toEqual(['teacher']);
  });

  it('an unlocked sheet is editable for its subject teacher and dead for anyone else', () => {
    expect(
      gradingSheetGates({
        viewRole: 'teacher',
        isLocked: false,
        isSubjectTeacherForSheet: true,
      })
    ).toMatchObject({ readOnly: false, isMonitoringOnly: false });
    expect(
      gradingSheetGates({
        viewRole: 'teacher',
        isLocked: false,
        isSubjectTeacherForSheet: false,
      })
    ).toMatchObject({ readOnly: true, isMonitoringOnly: true });
  });
});
