import type { Role } from '@/lib/auth/roles';

// The four interlocking flags that decide what a grading sheet lets you do,
// lifted out of `app/(markbook)/markbook/grading/[id]/page.tsx` so they can be
// stated once and tested directly.
//
// ⚠ WHY THEY LEFT THE PAGE (role-switcher Phase 3c). They are not independent:
// `readOnly` reads `canManage`, `requireApproval` reads it the other way round,
// and `isMonitoringOnly` exists solely to explain a `readOnly` the lock banner
// cannot. Written inline they were four expressions a reader had to hold in
// their head at once, and the phase that put the active-role lens through them
// needed to prove a property ABOUT the set — that switching to the Teacher view
// can only ever take editing away, never grant it. A page component is an async
// server component: it cannot be imported and called, so a property about it
// can only be asserted by scanning its source. Here it can be asserted by
// running it.
//
// ⚠ THIS IS NOT AN AUTHORIZATION GATE AND MUST NOT BECOME ONE. Every write on
// that page goes through `PATCH /api/grading-sheets/[id]/…`, which decides on
// the REAL JWT role and never sees `viewRole`. What this module answers is
// "which inputs does the screen offer", and the invariant it exists to keep is
// that the screen offers a SUBSET of what the route would accept — a page more
// permissive than its route is editable boxes and a 403 on save.
// `__tests__/markbook/grading-lens-direction.test.ts` pins that direction over
// every role × view pair.

export type GradingSheetGateInput = {
  /**
   * The role in force. For an account that both administers and teaches, this
   * is `'teacher'` once they have switched to it.
   */
  viewRole: Role | null;
  /** `grading_sheets.is_locked` — the term has been committed. */
  isLocked: boolean;
  /**
   * Does this viewer hold a subject_teacher row (or a relief row covering one)
   * for this sheet's section × subject?
   *
   * The raw assignment fact, with no role condition applied — the role
   * condition is this module's job. Resolved by `isSubjectTeacher` at the call
   * site, which needs the sheet's section and subject ids.
   */
  isSubjectTeacherForSheet: boolean;
};

export type GradingSheetGates = {
  /**
   * The oversight controls: the totals editor, the lock toggle, the audit-log
   * link, the per-cell change-request list and the editable final-grade box on
   * a non-examinable sheet.
   */
  canManage: boolean;
  /** Is this viewer the person who encodes THIS sheet? */
  isAssignedTeacher: boolean;
  /** Is the score grid rendered with dead inputs? */
  readOnly: boolean;
  /** Does a save prompt for an approval reference (Hard Rule #5)? */
  requireApproval: boolean;
  /**
   * A teacher looking at a sheet they do not teach — in practice the form
   * adviser, who reads every subject in their own section. Drives the banner
   * that says WHY the grid is dead, which the locked-sheet banner cannot
   * explain because the sheet may not be locked.
   */
  isMonitoringOnly: boolean;
};

export function gradingSheetGates({
  viewRole,
  isLocked,
  isSubjectTeacherForSheet,
}: GradingSheetGateInput): GradingSheetGates {
  const canManage =
    viewRole === 'academic_coordinator' ||
    viewRole === 'school_admin' ||
    viewRole === 'superadmin';

  // The assignment only counts when the viewer is being rendered AS a teacher.
  // An oversight view reads every sheet on the strength of the role, and giving
  // it `isAssignedTeacher` would flip `isMonitoringOnly` on for a coordinator.
  const isAssignedTeacher = viewRole === 'teacher' && isSubjectTeacherForSheet;

  // Two independent reasons to freeze the grid, and both must hold their own:
  // a locked sheet stops anyone without the manage right, and a teacher may
  // only encode their own subject. A form adviser sees every subject in their
  // section for monitoring; only the subject teacher writes to it.
  const readOnly =
    (isLocked && !canManage) || (viewRole === 'teacher' && !isAssignedTeacher);

  const requireApproval = isLocked && canManage;

  const isMonitoringOnly = viewRole === 'teacher' && !isAssignedTeacher;

  return {
    canManage,
    isAssignedTeacher,
    readOnly,
    requireApproval,
    isMonitoringOnly,
  };
}
