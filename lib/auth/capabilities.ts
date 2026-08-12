import type { Role } from '@/lib/auth/roles';

// The capability vocabulary — the WHAT of authorization. Who holds each one is
// data (`public.role_permissions`, migration 101, editable by a superadmin at
// /sis/admin/roles); the vocabulary itself is code, because a checkbox wired to
// no gate is worse than no checkbox.
//
// WHY THIS EXISTS. Role is read directly in seven independent layers (28
// ROUTE_ACCESS prefixes, 111 `requireRole` sites in 11 distinct role-set
// combinations, 35 inline narrowings, 8 route-group layouts, 53 page guards, 38
// role-derived flags under 25 different names, 31 nav entries). Two real needs
// can't be met inside that model:
//
//   1. One person at HFSE validates documents on BOTH sides of enrolment. The
//      rule that stops them (KD #147's ownership handoff) is correct, but it is
//      welded to a role NAME — see app/api/sis/students/[enroleeNumber]/
//      document/[slotKey]/route.ts — and a person holds exactly one role.
//   2. `school_admin` does two jobs (academics oversight + office admin).
//
// A capability moves the question from "which role are you" to "what may you
// do", which one person can hold two of.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE PARITY RULE, and why the grants below look inconsistent in places.
//
// `DEFAULT_ROLE_CAPABILITIES` reproduces TODAY'S BEHAVIOUR EXACTLY. It is the
// seed for migration 101, so applying that migration changes nothing. Every
// grant below cites the site it was read off, and where today's behaviour is
// asymmetric the asymmetry is REPRODUCED, not tidied up — a "cleanup" here
// would be a silent permission change on a live system. The asymmetries are
// called out in comments so the fix is a deliberate, separate decision.
//
// Resources are split so that each ACTION has a single uniform role set. That
// is why there are eight resources rather than the four a mockup would suggest:
// collapsing `academic_year.edit` with the calendar and section editors would
// have silently granted or removed `academic_coordinator` access, since those
// three surfaces genuinely gate differently today.
// ─────────────────────────────────────────────────────────────────────────────

export type ResourceDef = {
  key: string;
  /** Plain-English name shown in the permissions editor. */
  label: string;
  /** One line telling an admin what ticking these actually affects. */
  description: string;
  actions: readonly string[];
};

export const RESOURCES = [
  {
    key: 'documents_pre_enrolment',
    label: 'Documents — before enrolment',
    description:
      "Documents belonging to applicants who haven't enrolled yet, in the Admissions funnel.",
    // `validate` = approve or reject an uploaded file. `chase` = send the parent
    // a reminder or record a promised-by date. Deliberately separate: chasing is
    // routine follow-up, validating is a judgement recorded against the student.
    actions: ['read', 'chase', 'validate'],
  },
  {
    key: 'documents_post_enrolment',
    label: 'Documents — after enrolment',
    description:
      'Renewal documents for enrolled students — passports, passes, medical.',
    // `upload` exists only on this side: staff upload files for enrolled
    // students (P-Files is a repository), never for applicants, whose files
    // arrive from the parent portal.
    actions: ['read', 'chase', 'upload', 'validate'],
  },
  {
    key: 'academic_year',
    label: 'Academic Year',
    description:
      'Creating and configuring an academic year, its terms, and school-wide settings.',
    // `edit_terms` is separate from `edit` because the term editor admits the
    // academic coordinator while the rest of AY setup does not.
    actions: ['read', 'create', 'edit', 'edit_terms', 'delete'],
  },
  {
    key: 'school_calendar',
    label: 'School Calendar',
    description:
      'Day types, holidays, and events — what the attendance register treats as a school day.',
    actions: ['read', 'edit'],
  },
  {
    key: 'sections',
    label: 'Classes',
    description:
      'Creating classes, assigning subjects to them, and generating class index numbers.',
    actions: ['read', 'create', 'edit', 'delete'],
  },
  {
    // Its own group, not folded into `academic_year`, even though the routes
    // happen to admit the same two roles today. Folding them would mean
    // unticking "Change" under Academic Year silently also revoked subject
    // weights — a hidden coupling between two things a superadmin would expect
    // to control separately. No `delete`: a subject is referenced by historical
    // grade entries through subject_configs, so removal is SQL-only (KD #72).
    key: 'subjects',
    label: 'Subjects & Weights',
    description:
      'The subject list, which levels each is taught at, and the WW/PT/QA weighting behind every grade.',
    actions: ['read', 'create', 'edit'],
  },
  {
    key: 'staff',
    label: 'Staff & Accounts',
    description:
      'The staff directory, login accounts, and which classes each teacher is assigned to.',
    // `manage_relief` is separate from `edit_assignments` on purpose, not for
    // tidiness. Reassigning a class is day-to-day work the academic
    // coordinator does; arranging cover puts one teacher's name against
    // another's class while that teacher is away, which Mr Ace scoped to
    // school admin and above. Folding the two would have handed cover to the
    // coordinator as a side effect of a grant she already holds.
    actions: [
      'read',
      'view_accounts',
      'manage_accounts',
      'edit_assignments',
      'manage_relief',
    ],
  },
  {
    key: 'approvers',
    label: 'Approver Assignments',
    description:
      'Choosing which staff may be nominated to approve grade changes.',
    actions: ['manage'],
  },
  {
    key: 'grade_changes',
    label: 'Grade Change Requests',
    description:
      'The approval inbox for edits to grades on a locked sheet, and deciding them.',
    actions: ['read', 'approve'],
  },
] as const satisfies readonly ResourceDef[];

type ResourceEntry = (typeof RESOURCES)[number];

/** `resource.action` for every action each resource actually declares. */
type CapabilitiesOf<E> = E extends {
  key: infer K extends string;
  actions: readonly (infer A extends string)[];
}
  ? `${K}.${A}`
  : never;

export type Capability = CapabilitiesOf<ResourceEntry>;
export type ResourceKey = ResourceEntry['key'];

/** Runtime mirror of the `Capability` union — one list, never two (the same
 *  derive-don't-duplicate rule `ALL_AUDIT_ACTIONS` follows in
 *  lib/audit/log-action.ts, where a test enforces it). */
export const ALL_CAPABILITIES = RESOURCES.flatMap((resource) =>
  resource.actions.map((action) => `${resource.key}.${action}`)
) as Capability[];

const CAPABILITY_SET = new Set<string>(ALL_CAPABILITIES);

/** Is this string a capability the code actually gates on? Guards the write
 *  path: a row in `role_permissions` naming an unknown capability would be a
 *  permission that appears granted and enforces nothing. */
export function isCapability(value: string): value is Capability {
  return CAPABILITY_SET.has(value);
}

export function resourceFor(key: string): ResourceDef | undefined {
  return RESOURCES.find((r) => r.key === key);
}

// ─────────────────────────────────────────────────────────────────────────────
// Default grants — the exact authorization in force before this layer existed.
// Each block cites its source. Do not "tidy" these.
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_ROLE_CAPABILITIES: Record<Role, Capability[]> = {
  // GET /api/sections admits `teacher` (app/api/sections/route.ts:12-17);
  // `sections` is reference data that migration 005 calls "read-only UI
  // scaffolding". A teacher's own filed change requests live on a different
  // surface (/markbook/grading/requests) and are scoped by requester identity,
  // not by this capability — so `grade_changes.read`, which means "may open the
  // approval inbox", is correctly absent here.
  teacher: ['sections.read'],

  academic_coordinator: [
    // DOCUMENT WORK MOVED OFF HER (2026-07-31, migration 106). She originally
    // held pre-enrolment read/chase/validate plus post-enrolment validate —
    // the pre-capability behaviour migration 101 transcribed. Mr Ace has since
    // handed document validation to the P-Files officer and school_admin, and
    // confirmed the reassignment was deliberate; it had already been made
    // directly in `role_permissions`, so the code was the thing out of date,
    // not the database. Her four document grants are dropped here and deleted
    // by 106. She keeps no document capability at all.
    // The asymmetry that used to sit here — `edit_terms` without `read`,
    // because PATCH /api/sis/ay-setup/terms/[termId] admitted her while
    // /sis/ay-setup redirected her away — was RESOLVED on 2026-07-31 on Mr
    // Ace's instruction: she now gets the AY Setup page itself. Her AY power is
    // deliberately identical to school_admin's (read/create/edit/edit_terms and
    // NOT delete, which stays superadmin-only per KD #40), so the page has no
    // button that renders for her and then 403s.
    'academic_year.read',
    'academic_year.create',
    'academic_year.edit',
    'academic_year.edit_terms',
    'school_calendar.read',
    'school_calendar.edit',
    'sections.read',
    'sections.create',
    'sections.edit',
    'sections.delete',
    // Granted 2026-07-31 on Mr Ace's instruction. /sis/admin/subjects and its
    // routes were school_admin + superadmin; the ROUTE_ACCESS row had already
    // been widened to admit her in anticipation of exactly this grant, so the
    // page was reachable but redirected on the missing `subjects.read`. All
    // three actions, not just read — the weights matrix's "add subject" and
    // per-cell editors are on the same surface, and granting read alone leaves
    // buttons that render and then 403 (the failure mode this file's
    // school_admin block flags on the admissions validation queue).
    'subjects.read',
    'subjects.create',
    'subjects.edit',
    'staff.read',
    'staff.edit_assignments',
    // /markbook/change-requests admits her (page.tsx:30-37) but decide.ts:124
    // rejects her — she APPLIES approved requests, she does not approve them.
    // That separation of duties is the point of the dual-reviewer trail.
    'grade_changes.read',
  ],

  school_admin: [
    // SHE VALIDATES NOW, ON BOTH SIDES (2026-07-31, migration 106). She used
    // to be read-and-chase only: the PATCH route excluded her ("school_admin
    // intentionally excluded", KD #74 + KD #31) while the queue still RENDERED
    // her Approve/Reject buttons, which then 403'd — a real bug this file
    // recorded as outstanding. Mr Ace granted her validation directly in
    // `role_permissions` and confirmed it was deliberate, which resolves that
    // bug by making the buttons work rather than by hiding them.
    'documents_pre_enrolment.read',
    'documents_pre_enrolment.chase',
    'documents_pre_enrolment.validate',
    // No longer read-only oversight on the P-Files side: chase, upload and
    // validate came with the same reassignment. The page's `isOfficer` flag
    // (page.tsx:33-34) is now the narrower gate — worth revisiting, since it
    // hides actions she is now permitted to take.
    'documents_post_enrolment.read',
    'documents_post_enrolment.chase',
    'documents_post_enrolment.upload',
    'documents_post_enrolment.validate',
    'academic_year.read',
    'academic_year.create',
    'academic_year.edit',
    'academic_year.edit_terms',
    'school_calendar.read',
    'school_calendar.edit',
    'sections.read',
    'sections.create',
    'sections.edit',
    'sections.delete',
    // /sis/admin/subjects and every /api/sis/admin/subjects/** route are
    // school_admin + superadmin (the academic coordinator is excluded).
    'subjects.read',
    'subjects.create',
    'subjects.edit',
    'staff.read',
    // canSeeAccounts is `role !== 'academic_coordinator'`
    // (app/(sis)/sis/admin/staff/page.tsx:59) — she sees the Accounts tab
    // read-only; canManageAccounts is superadmin-only (:65).
    'staff.view_accounts',
    'staff.edit_assignments',
    // Arranging cover for an absent teacher. Held here and by superadmin only
    // — deliberately NOT by the academic coordinator, who holds
    // `staff.edit_assignments` beside it (Mr Ace, 2026-08-11).
    'staff.manage_relief',
    'grade_changes.read',
    // The ONLY holder. lib/change-requests/decide.ts:124 permits exactly this
    // role — see the superadmin block below for why that matters.
    'grade_changes.approve',
  ],

  superadmin: [
    'documents_pre_enrolment.read',
    'documents_pre_enrolment.chase',
    'documents_pre_enrolment.validate',
    'documents_post_enrolment.read',
    'documents_post_enrolment.chase',
    'documents_post_enrolment.upload',
    'documents_post_enrolment.validate',
    'academic_year.read',
    'academic_year.create',
    'academic_year.edit',
    'academic_year.edit_terms',
    'academic_year.delete',
    'school_calendar.read',
    'school_calendar.edit',
    'sections.read',
    'sections.create',
    'sections.edit',
    'sections.delete',
    'subjects.read',
    'subjects.create',
    'subjects.edit',
    'staff.read',
    'staff.view_accounts',
    'staff.manage_accounts',
    'staff.edit_assignments',
    'staff.manage_relief',
    'approvers.manage',
    'grade_changes.read',
    // DELIBERATELY ABSENT: 'grade_changes.approve'.
    //
    // This looks wrong and is right. lib/change-requests/decide.ts:120-130
    // rejects every role except `school_admin`, superadmin included, and says
    // why: a superadmin decides WHO may approve (via /sis/admin/approvers) and
    // does not approve themselves. Granting it here would be a real privilege
    // change, not a parity fix.
    //
    // Today /markbook/change-requests:38 nonetheless computes
    // `canDecide = school_admin || superadmin`, so a superadmin is shown
    // Approve/Reject buttons that always 403. That is bug 2 in the plan; Phase 5
    // fixes it by deriving `canDecide` from this capability, at which point the
    // absence of this line is what makes the buttons disappear.
  ],

  p_file_officer: [
    // The whole post-enrolment document lifecycle: the validation queue
    // (page.tsx:25-31 + isOfficer), staff upload
    // (app/api/p-files/[enroleeNumber]/upload/route.ts:69), and the P-Files
    // branch of notify / bulk-notify / promise.
    'documents_post_enrolment.read',
    'documents_post_enrolment.chase',
    'documents_post_enrolment.upload',
    'documents_post_enrolment.validate',
    // BOTH SIDES OF ENROLMENT (2026-07-31, migration 106). This is the change
    // the whole capability layer was built for — the note that used to sit here
    // predicted it exactly ("granting documents_pre_enrolment.validate here is
    // exactly the change HFSE asked for, and it is a data edit, not a code
    // change"). It was made as a data edit; 106 writes it into the seed so the
    // code stops disagreeing with production.
    //
    // No route change was needed: /p-files/document-validation is already the
    // unified queue and loads the applicant rows whenever the viewer holds
    // `documents_pre_enrolment.read`, so the officer sees both queues in the
    // module they can already reach.
    //
    // ONE route was opened afterwards (KD #173): the applicant FILE at
    // /admissions/applications/[enroleeNumber], which every row in that new
    // Applicants tab links to. `/admissions` otherwise still excludes them at
    // ROUTE_ACCESS, deliberately — including the applications list next door —
    // and the file renders read-only for them. The capability gives them the
    // WORK, not the whole Admissions module.
    'documents_pre_enrolment.read',
    'documents_pre_enrolment.chase',
    'documents_pre_enrolment.validate',
  ],

  admissions: [
    'documents_pre_enrolment.read',
    'documents_pre_enrolment.chase',
    'documents_pre_enrolment.validate',
    // No post-enrolment grant — route.ts:77-86 403s them on an enrolled
    // student (those documents are P-Files' territory).
  ],
};

/** Does this role's capability list include `capability`? Pure — the caller
 *  supplies the list, from `getRoleCapabilities()` in production or a literal
 *  in a test. */
export function can(
  capabilities: readonly Capability[] | undefined,
  capability: Capability
): boolean {
  return !!capabilities?.includes(capability);
}
