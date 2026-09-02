// Classroom scope — "which classes can this user open, and in what capacity."
//
// There was no single helper for this before: the codebase answered it three
// different ways (`listFormAdviserSectionIds` for Evaluation, an inline
// `teacher_assignments` query in the Attendance section list, and nothing at
// all in Markbook's, which showed every user every section).
//
// The capability a user holds over a section is NOT a UI preference — it
// mirrors what RLS already enforces in supabase/migrations/005_rls_teacher_scoping.sql:
//
//   attendance_records      -> is_adviser_for_section   (form adviser only)
//   report_card_comments    -> is_adviser_for_section   (form adviser only)
//   grading_sheets/entries  -> is_teacher_for_sheet     (own subject, or any if adviser)
//   students/section_students -> is_teacher_for_section (any assignment)
//
// So a subject-teacher-only user genuinely cannot read a section's attendance
// or write-ups. The classroom must render a narrowed view for them rather than
// panels that would come back empty. `canReadAttendance` / `canReadWriteups`
// below are the single source for that decision — do not re-derive it inline.
//
// ⚠ WHICH ROLE THE CALLER PASSES IS THE CALLER'S DECISION, AND IT DIFFERS.
// Since the active-role lens landed (lib/auth/active-role.ts), the six
// `school_admin` accounts that also teach can look at the app AS a teacher:
//
//        role authorises.  activeRole renders.
//
//   • A page or layout passes `activeRole` — it is deciding what to SHOW.
//   • An API route passes the real `role` — it is deciding what to ALLOW.
//
// This module deliberately does NOT read the lens itself. It cannot: the same
// two functions serve both audiences, and `app/api/classroom/**` gates
// service-client reads on `loadClassroomAccess`, where RLS is not behind the
// call site — the call site IS the boundary. A helper that reached for
// `getViewContext()` internally would put a viewer-controlled cookie inside
// those route decisions, and `__tests__/auth/active-role-never-authorises.test.ts`
// could not see it, because the route itself would never name the lens.
// So the role stays a parameter. Ruled 2026-09-02 (role-switcher Phase 3a).
//
// The narrowing only ever runs one way, which is why this is safe. Entitlement
// adds `'teacher'` only for an account that genuinely holds assignment rows,
// and teacher scope is derived from those same rows — so a teaching admin in
// the Teacher lens sees a STRICT SUBSET of what her account role already
// reaches. A real teacher's entitled set is exactly `['teacher']`, so nothing
// about a teacher's behaviour can change at all.

import type { Role } from '@/lib/auth/roles';
import type {
  AssignmentRow,
  EffectiveAssignmentRow,
} from '@/lib/auth/teacher-assignments';
import { isAdviserRole, isSubjectRole } from '@/lib/schemas/teacher-assignment';

/** What a user may do in a given class. */
export type ClassroomCapability =
  | 'adviser' // form adviser: the full classroom
  | 'subject' // subject teacher only: roster + their own subject's sheet
  | 'oversight'; // coordinator / school_admin / superadmin: read everything

/** Roles that see every class in the AY rather than only assigned ones. */
const OVERSIGHT_ROLES: ReadonlySet<Role> = new Set<Role>([
  'academic_coordinator',
  'school_admin',
  'superadmin',
]);

export type ClassroomScope = {
  /**
   * `null` means "every section in the AY" (oversight roles) — callers should
   * skip the id filter entirely rather than pass a huge IN list. An empty
   * array means "no classes at all" (admissions / p_file_officer), which is
   * distinct from null and must not be treated as unscoped.
   */
  sectionIds: string[] | null;
  /** Only populated for assignment-derived scopes; empty for oversight. */
  capabilityBySection: Record<string, ClassroomCapability>;
  /**
   * The same map built from assignments the teacher actually HOLDS — cover
   * excluded.
   *
   * Two maps because relief teachers split one question in two. A substitute
   * takes attendance and enters marks, but the regular adviser still writes the
   * write-ups and the report card comment even while away (Mr Ace, 2026-08-11).
   * So "may act" and "is the adviser of record" now have different answers, and
   * a single map cannot express both.
   *
   * Use `capabilityForSection` for what someone may do; use
   * `substantiveCapabilityForSection` for anything that is the adviser's own
   * work. Which predicates take which is enforced by
   * `__tests__/auth/assignment-read-classification.test.ts` — evaluation_writeups
   * has no adviser predicate in RLS at all, so these call sites are the only
   * thing keeping a substitute out of another teacher's write-ups.
   */
  substantiveCapabilityBySection: Record<string, ClassroomCapability>;
  isOversight: boolean;
};

/**
 * Pure. Derives scope from assignment rows already loaded by
 * `loadEffectiveAssignmentsForUser`, so it is unit-testable without a database.
 *
 * ⚠ `role` IS THE ROLE TO RESOLVE SCOPE *FOR*, NOT NECESSARILY THE ACCOUNT'S.
 * Pages and layouts pass `activeRole` (the lens the viewer is looking through);
 * API routes pass the real `role` from the JWT. See the ruling at the top of
 * this file for why that choice belongs to the caller and can never move in
 * here. Passing `'teacher'` for an account whose role is `school_admin` is the
 * supported case, not a misuse: the assignments handed in are that account's
 * own, so the scope it produces is narrower than the oversight they already
 * had.
 *
 * A section where the user holds BOTH a form_adviser row and a
 * subject_teacher row resolves to 'adviser' — the wider capability wins,
 * matching `is_teacher_for_sheet`, which lets an adviser read every subject
 * in their own section.
 *
 * Rows with `via: 'relief'` count toward `capabilityBySection` and are kept out
 * of `substantiveCapabilityBySection`. Plain `AssignmentRow`s carry no `via` and
 * are treated as substantive, so existing callers that pass held assignments
 * behave exactly as before.
 */
export function resolveClassroomScope(
  role: Role | null,
  assignments: Array<AssignmentRow | EffectiveAssignmentRow>
): ClassroomScope {
  if (role != null && OVERSIGHT_ROLES.has(role)) {
    return {
      sectionIds: null,
      capabilityBySection: {},
      substantiveCapabilityBySection: {},
      isOversight: true,
    };
  }

  // Only `teacher` derives scope from assignments. Every other role
  // (admissions, p_file_officer, or a null/unknown role) gets nothing —
  // they have no teaching relationship to any class.
  if (role !== 'teacher') {
    return {
      sectionIds: [],
      capabilityBySection: {},
      substantiveCapabilityBySection: {},
      isOversight: false,
    };
  }

  const capabilityBySection: Record<string, ClassroomCapability> = {};
  const substantiveCapabilityBySection: Record<string, ClassroomCapability> =
    {};

  for (const a of assignments) {
    const isRelief = 'via' in a && a.via === 'relief';
    const targets = isRelief
      ? [capabilityBySection]
      : [capabilityBySection, substantiveCapabilityBySection];

    for (const map of targets) {
      // Co roles carry the same classroom capability as their primary
      // (migration 124) — a co-adviser advises, a co-teacher teaches.
      if (isAdviserRole(a.role)) {
        map[a.section_id] = 'adviser';
      } else if (isSubjectRole(a.role)) {
        // Never downgrade an adviser to subject, regardless of row order.
        map[a.section_id] ??= 'subject';
      }
    }
  }

  return {
    sectionIds: Object.keys(capabilityBySection),
    capabilityBySection,
    substantiveCapabilityBySection,
    isOversight: false,
  };
}

/**
 * What this user may DO in one section — including a class they are only
 * covering. Use for attendance, marks, roster: the working surfaces.
 */
export function capabilityForSection(
  scope: ClassroomScope,
  sectionId: string
): ClassroomCapability | null {
  if (scope.isOversight) return 'oversight';
  return scope.capabilityBySection[sectionId] ?? null;
}

/**
 * What this user IS in one section, ignoring cover. Use for the adviser's own
 * work — write-ups and the report card comment — which stays with the regular
 * adviser while they are away.
 *
 * A substitute covering an adviser gets `null` here and `'adviser'` from
 * `capabilityForSection`. That difference is the entire point; passing the
 * wrong one to `canReadWriteups` would let a stand-in write in the adviser's
 * name, and `evaluation_writeups` has no RLS predicate to catch it.
 */
export function substantiveCapabilityForSection(
  scope: ClassroomScope,
  sectionId: string
): ClassroomCapability | null {
  if (scope.isOversight) return 'oversight';
  return scope.substantiveCapabilityBySection[sectionId] ?? null;
}

/**
 * Attendance is adviser-only at the DB level (`is_adviser_for_section`).
 * A subject teacher's classroom must not offer it.
 */
export function canReadAttendance(
  capability: ClassroomCapability | null
): boolean {
  return capability === 'adviser' || capability === 'oversight';
}

/** FCA write-ups are adviser-only, same RLS predicate as attendance. */
export function canReadWriteups(
  capability: ClassroomCapability | null
): boolean {
  return capability === 'adviser' || capability === 'oversight';
}

/** Any capability at all means the roster is readable (`is_teacher_for_section`). */
export function canReadRoster(capability: ClassroomCapability | null): boolean {
  return capability != null;
}

/**
 * A report card is adviser work. It carries the term attendance table AND the
 * form-adviser comment — both `is_adviser_for_section` at the DB — so it takes
 * the same predicate as those two, not `is_teacher_for_sheet`.
 *
 * A subject teacher's card would be structurally hollow rather than merely
 * partial: every other subject's cells blank (`is_teacher_for_sheet`), every
 * attendance cell N.A., and the adviser name a dash, since
 * `teacher_assignments` returns only their own rows. Showing that is worse
 * than not showing it.
 *
 * Named separately from `canReadWriteups` despite the identical body so the
 * call site reads honestly and either can change without dragging the other.
 */
export function canReadReportCard(
  capability: ClassroomCapability | null
): boolean {
  return capability === 'adviser' || capability === 'oversight';
}

/**
 * Whether this user can open the permanent student record at
 * `/records/students/[studentNumber]`.
 *
 * NOT the same question as `canReadRoster`: a teacher may read every name on
 * their roster and open none of the records behind them. `/records` is
 * registrar-and-above in ROUTE_ACCESS (lib/auth/roles.ts), which is exactly
 * the three roles `OVERSIGHT_ROLES` names above — that equality is what makes
 * this answerable from capability alone, and it is pinned by
 * __tests__/classroom/student-record-link.test.ts so a future narrowing of
 * `/records` cannot silently desync from this predicate.
 *
 * Exists because the classroom rendered every student name as a link to that
 * page for everyone, so a form adviser clicking a student on their own roster
 * was bounced to `/` by the proxy. KD #173's rule — the link layer gates on
 * the same thing the page does — applied to an in-page link rather than a nav
 * item.
 */
export function canOpenStudentRecord(
  capability: ClassroomCapability | null
): boolean {
  return capability === 'oversight';
}

/**
 * Whether this user may edit a disciplinary record they did not file.
 *
 * FILING is open to any staff member — Chandana, 2026-08-14: incident reports
 * are filed by "the person in charge who is present at the venue of incident",
 * which is a circumstance rather than a role. EDITING is narrower: the filer,
 * plus leadership (Mr Ace, 2026-08-17). This predicate is only the second
 * half; the route ORs it with `record.filedBy === user.id`.
 *
 * Named separately from `canOpenStudentRecord` despite the identical body, per
 * this file's convention — that one answers "may they open /records", which is
 * a routing question that could narrow on its own without changing who may
 * correct a filing.
 */
export function canManageAnyDisciplineRecord(
  capability: ClassroomCapability | null
): boolean {
  return capability === 'oversight';
}
