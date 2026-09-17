// Audit-log humanization — pure, framework-free helpers that turn raw audit
// rows (machine action codes + JSON context) into plain English for the
// per-module audit-log pages. NO React / Next imports — safe to unit-test and
// to call from server components.
//
// Three exports:
//   auditActionLabel(action)            → human title for the action code
//   auditActionTone(action)             → badge tone bucket
//   auditContextSummary(action, ctx)    → one-line plain-English summary,
//                                         NEVER JSON (no `{` / `}` ever).
//
// Label maps are IMPORTED from the schema modules (single source of truth) —
// they are not redefined here.
//
// HOW A SUMMARY IS BUILT (2026-09-17)
//
//   [warning] · [who / which class] · [what happened]
//
//   - `warning` — "Only partly saved — stopped at: …" when the writer recorded a
//     write that committed half-way (`partial: true` + `failed_step`).
//   - `who / which class` — the student (name, else number), the class, the
//     subject and the term, read from the identity keys the writers stamp in
//     either spelling (`studentName` / `student_name`, `section_name` /
//     `sectionName`, …). Anything the per-action text below already says is
//     not repeated.
//   - `what happened` — a per-action template, or the generic fallback.
//
// OLD ROWS MUST KEEP RENDERING. `audit_log` is append-only (Hard Rule #6), so
// every template reads the new key names FIRST and the older shapes after
// them. Never drop an old reader when adding a new one.

import type { AuditAction } from '@/lib/audit/log-action';
import { ROLE_LABEL } from '@/lib/auth/role-labels';
import type { Role } from '@/lib/auth/roles';
import { DOCUMENT_SLOTS } from '@/lib/p-files/document-config';
import { toPlainText } from '@/lib/rich-text';
import {
  APPROVAL_RULE_LABELS,
  APPROVER_LEVEL_SCOPE_LABELS,
  STAGED_FLOW_LABELS,
} from '@/lib/schemas/approval-flows';
import { APPROVER_FLOW_LABELS } from '@/lib/schemas/approvers';
import {
  ATTENDANCE_STATUS_LABELS,
  EX_REASON_LABELS,
  DAY_TYPE_LABELS,
  AUDIENCE_LABELS,
  EVENT_CATEGORY_LABELS,
} from '@/lib/schemas/attendance';
import { DISCIPLINE_RECORD_TYPE_LABELS } from '@/lib/schemas/discipline';
import {
  ENROLLMENT_STATUS_LABELS,
  WITHDRAWAL_REASON_LABELS,
} from '@/lib/schemas/enrolment';
import {
  REASON_CATEGORY_LABELS,
  CORRECTION_REASON_LABELS,
} from '@/lib/schemas/change-request';
import {
  APPLICATION_TERMINAL_REASON_LABELS,
  STAGE_LABELS,
} from '@/lib/schemas/sis';
import {
  ASSIGNMENT_CHANGE_REASON_LABELS,
  ASSIGNMENT_ROLE_LABELS,
} from '@/lib/schemas/teacher-assignment';

// ─────────────────────────────────────────────────────────────────────────
// 1. auditActionLabel
// ─────────────────────────────────────────────────────────────────────────

// Concise human label for every member of the AuditAction union in
// lib/audit/log-action.ts. Typed as Record<AuditAction, string> (not
// Record<string, string>) so adding a new AuditAction WITHOUT a label here
// is a compile error, not a silent prettify() fallback at runtime.
const ACTION_LABELS: Record<AuditAction, string> = {
  // Grading sheets
  'sheet.create': 'Sheet created',
  'sheet.bulk_create': 'Sheets created',
  'sheet.lock': 'Sheet locked',
  'sheet.unlock': 'Sheet unlocked',
  'sheet.unlock_force_with_pending_crs':
    'Sheet force-unlocked (pending requests)',
  'sheet.unlock_force_deadline_passed':
    'Sheet force-unlocked (deadline passed)',
  'sheet.lock_overdue_batch': 'Overdue sheets auto-locked',
  'sheet.labels.update': 'Activity labels updated',

  // Grade entries
  'entry.update': 'Grade updated',
  'totals.update': 'Totals updated',
  grade_correction: 'Grade corrected',
  'grade_entry.annual_letter.update': 'Final grade updated',

  // Classroom (Phase 6) — never logs note CONTENT (private, migration 094's
  // RLS is the boundary that matters; this row is metadata-only, same
  // "length not content" convention as evaluation.writeup.save).
  'classroom.note.save': 'Class note saved',

  // Disciplinary records (#7) — the row records THAT something was filed and
  // by whom, never what it said. Same "metadata, not content" line as the
  // class note above and attendance's excused-absence note: audit_log is
  // append-only and readable by every coordinator and above, so a child's
  // behavioural narrative typed in error would be permanent and widely
  // visible. The record itself is the place to read it.
  'discipline.record.file': 'Discipline record filed',
  'discipline.record.update': 'Discipline record updated',

  // Parent-filed declarations. Same privacy rule as the two notes above: the
  // parent's message and the approver's reason are BOTH kept out of the
  // context, and only their presence is recorded.
  'declaration.approve': 'Absence declaration approved',
  'declaration.reject': 'Absence declaration turned down',
  // How a declaration came to exist, kept apart from how it was decided.
  'declaration.file': 'Declaration filed by a parent',
  'declaration.file.staff': 'Medical certificate recorded by the school',
  'declaration.evidence.attach': 'Certificate added to a declaration',

  // Students / enrolment
  'student.sync': 'Student synced',
  'student.add': 'Student added',
  'student.section.transfer': 'Section transfer',
  'student.withdrawal.cascade': 'Student withdrawn',
  'student.reenrolment.cascade': 'Student re-enrolled',
  'sis.student.assign_section': 'Section assigned',
  'sis.student.auto_sync_batch': 'Students auto-synced',
  'sis.student.export_raw': 'Student data downloaded',
  'enrolment.metadata.update': 'Enrolment updated',

  // Teacher assignments
  'assignment.create': 'Teacher assigned',
  'assignment.delete': 'Teacher assignment removed',
  'assignment.relief.start': 'Relief teacher arranged',
  'assignment.relief.end': 'Relief teacher finished',

  // Sections
  'section.create': 'Section created',
  'section.rename': 'Section renamed',
  'section.delete': 'Section removed',
  'section.realphabetize': 'Roster re-alphabetized',
  'section.index.generate': 'Class index generated',
  'section.index.swap': 'Index numbers swapped',
  'section.track.assign': 'Section track set',
  'section.schedule.update': 'Section schedule set',
  'section.subject.assign': 'Subject attached to section',
  'section.subject.remove': 'Subject removed from section',
  'section.subjects.load_defaults': 'Default subjects loaded',
  'section.subjects.attach_many': 'Subjects attached in bulk',

  // Attendance
  'attendance.update': 'Attendance updated',
  'attendance.daily.update': 'Attendance updated',
  'attendance.daily.correct': 'Attendance corrected',
  'attendance.import.bulk': 'Attendance imported',
  'attendance.calendar.upsert': 'School calendar updated',
  'attendance.calendar.delete': 'Calendar entry removed',
  'attendance.calendar.autoseed': 'School calendar seeded',
  'attendance.calendar.copy_from_prior_ay': 'Calendar copied from prior year',
  'attendance.event.create': 'Calendar event added',
  'attendance.event.update': 'Calendar event updated',
  'attendance.event.delete': 'Calendar event removed',

  // Comments / publications
  'comment.update': 'Comment updated',
  'publication.create': 'Report card published',
  'publication.delete': 'Report card unpublished',

  // Grade-change requests
  grade_change_requested: 'Grade change requested',
  grade_change_approved: 'Grade change approved',
  grade_change_rejected: 'Grade change rejected',
  grade_change_cancelled: 'Grade change cancelled',
  grade_change_applied: 'Grade change applied',
  grade_change_undo_rejection: 'Grade change rejection undone',

  // P-Files
  'pfile.upload': 'Document uploaded',
  'pfile.reminder.sent': 'Reminder sent',
  'pfile.reminder.bulk': 'Reminders sent',
  'pfile.mark.promised': 'Marked as promised',

  // Admissions chase
  'admissions.reminder.sent': 'Reminder sent',
  'admissions.reminder.bulk': 'Reminders sent',
  'admissions.mark.promised': 'Marked as promised',

  // SIS / admissions edits
  'sis.profile.update': 'Profile updated',
  'sis.family.update': 'Family details updated',
  'sis.stage.update': 'Enrolment stage updated',
  'sis.stp.update': 'Student Pass updated',
  'sis.precourse.update': 'Pre-course session recorded',
  'sis.discount_code.create': 'Discount code created',
  'sis.discount_code.update': 'Discount code updated',
  'sis.discount_code.expire': 'Discount code expired',
  'sis.document.approve': 'Document approved',
  'sis.document.reject': 'Document rejected',
  'sis.documents.auto-expire': 'Documents auto-expired',
  'sis.documents.auto-revive': 'Documents auto-revived',
  'sis.allowance.update': 'Leave allowance updated',
  'sis.vl_allowance.update': 'Vacation allowance updated',
  'sis.house.update': 'House updated',
  'sis.level.create': 'Level created',

  // Grade levels (Levels & Grade Progression, migration 078) — the admin
  // page + write routes were removed by migration 086; labels kept so
  // historical audit_log rows still render in plain English (Hard Rule #6).
  'level.create': 'Grade level added',
  'level.update': 'Grade level updated',
  'level.delete': 'Grade level removed',
  'level.offering.toggle': 'Level offering changed',
  'level.alias.create': 'Level naming variant mapped',
  'level.alias.remap': 'Level naming variant re-mapped',

  // Academic years
  'ay.create': 'Academic year created',
  'ay.switch_current': 'Current year switched',
  'ay.accepting_applications.toggle': 'Application window toggled',
  'ay.delete': 'Academic year deleted',
  'ay.term_dates.update': 'Term dates updated',
  'ay.term_virtue.update': 'Term virtue updated',
  'ay.term_grading_lock.update': 'Grading lock dates updated',
  'ay.copy_teacher_assignments': 'Teacher assignments copied',

  // Evaluation
  'evaluation.writeup.save': 'Write-up saved',
  'evaluation.writeup.submit': 'Write-up submitted',
  'evaluation.writeup.resubmit': 'Write-up resubmitted',
  'evaluation.checklist_item.create': 'Topic added',
  'evaluation.checklist_item.update': 'Topic updated',
  'evaluation.checklist_item.delete': 'Topic removed',
  'evaluation.checklist_item.reorder': 'Topics reordered',
  'evaluation.checklist_item.copy_from': 'Topics copied',
  'evaluation.checklist_response.save': 'Topic rating saved',
  'evaluation.subject_comment.save': 'Subject comment saved',
  'evaluation.ptc_feedback.save': 'Conference feedback saved',

  // Approvers
  'approver.assign': 'Approver assigned',
  'approver.revoke': 'Approver removed',

  // Ordered approval steps (migration 126) — the configurable kind, as
  // distinct from the pooled pair above.
  'approval_stage.create': 'Approval step added',
  'approval_stage.update': 'Approval step changed',
  'approval_stage.delete': 'Approval step retired',
  'approval_stage.approver.assign': 'Person added to an approval step',
  'approval_stage.approver.revoke': 'Person removed from an approval step',

  // Subjects / templates
  'subject_config.update': 'Subject weights updated',
  'subject_config.create': 'Subject weights set',
  // Plain words for a school admin: this is "Filipino has no exam in Term 3",
  // not "qa_weight set to 0 on 20 grading sheets".
  'subject_config.term_weights': 'Subject weights changed for one term',
  'subject_level_offering.toggle': 'Subject level attachment updated',
  'subject_report_map.update': 'Subject report mapping updated',
  'subject.catalog.update': 'Subject grade type or grading method updated',
  'template.section.create': 'Template section created',
  'template.section.update': 'Template section updated',
  'template.section.delete': 'Template section removed',
  'template.subject_config.create': 'Template subject added',
  'template.subject_config.update': 'Template subject updated',
  'template.subject_config.delete': 'Template subject removed',
  'template.subject_config.bulk_delete': 'Template subjects removed',
  'subject.create': 'Subject created',
  'template.apply': 'Template applied',
  'school_config.update': 'School settings updated',

  // Users
  'user.invite': 'User invited',
  'user.create': 'User created',
  'user.info.update': 'User details updated',
  'user.role.update': 'User role changed',
  'role.permissions.update': 'Role permissions changed',
  'user.disable': 'User disabled',
  'user.enable': 'User enabled',
  'user.delete': 'User deleted',
  'user.login': 'Signed in',
  // Somebody who holds two roles switched which one is in force. It IS a
  // change of role for everything they do afterwards — every permission check
  // reads the role in force — so it is not called a "view". It is still a
  // different entry from 'user.role.update' two rows up, which is an admin
  // changing which roles a person holds.
  'user.view.switch': 'Switched role',
  'user.password.change': 'Password changed',

  // Environment / seeding (KD #52) — the test-AY Environment switcher +
  // seeder were removed once the test AYs themselves were gone from the
  // database and testing moved to real AY2026 with throwaway accounts.
  // Labels kept so historical audit_log rows still render in plain English
  // (Hard Rule #6); no code emits these anymore.
  'environment.switch': 'Environment switched',
  'environment.seed': 'Demo data seeded',
  'environment.topup': 'Demo data topped up',
  'environment.demo_accounts_removed': 'Demo accounts removed',

  // Parent sessions
  'parent.session.issued': 'Parent signed in',
  'parent.session.cleared': 'Parent signed out',
};

export function auditActionLabel(action: string): string {
  return ACTION_LABELS[action as AuditAction] ?? prettify(action);
}

// ─────────────────────────────────────────────────────────────────────────
// 2. auditActionTone
// ─────────────────────────────────────────────────────────────────────────

export function auditActionTone(
  action: string
): 'default' | 'info' | 'warning' | 'destructive' {
  const a = action.toLowerCase();

  // destructive — irreversible / negative outcomes
  if (
    a.includes('delete') ||
    a.includes('reject') ||
    a.includes('withdrawal') ||
    a.includes('disable') ||
    a.includes('auto-expire') ||
    a === 'ay.delete'
  ) {
    return 'destructive';
  }

  // warning — overrides / removals of protection
  if (
    a.includes('unlock') ||
    a.includes('overdue') ||
    a.includes('force') ||
    a.includes('revoke')
  ) {
    return 'warning';
  }

  // info — passive / system / notification events
  if (
    a.includes('login') ||
    a.includes('session') ||
    // Exact, not `includes('switch')` — a substring match would sweep up any
    // future `*.switch` action.
    a === 'user.view.switch' ||
    a.includes('seed') ||
    a.includes('topup') ||
    a.includes('sync') ||
    a.includes('reminder')
  ) {
    return 'info';
  }

  return 'default';
}

// ─────────────────────────────────────────────────────────────────────────
// 3. auditContextSummary
// ─────────────────────────────────────────────────────────────────────────

const SEP = ' · ';
const ARROW = ' → ';
const EMPTY = '—';
const LIST_CAP = 4;
/** How many names a list shows before "+N more". */
const LIST_PREVIEW = 3;

export function auditContextSummary(
  action: string,
  context: Record<string, unknown> | null | undefined
): string {
  if (!context || typeof context !== 'object' || Array.isArray(context))
    return EMPTY;

  const templated = templateSummary(action, context);
  const bodyRaw = (templated ?? genericSummary(context)).trim();
  const body = bodyRaw === EMPTY ? '' : bodyRaw;
  const warning = partialWarning(context);
  const lead = contextLead(action, context, `${warning} ${body}`);

  const cleaned = [warning, lead, body]
    .map((p) => flattenMarkup(p).trim())
    .filter(Boolean)
    .join(SEP);
  if (!cleaned) return EMPTY;
  // Hard guarantee: never let a brace leak through.
  if (cleaned.includes('{') || cleaned.includes('}')) {
    return genericSummary(context, true) || EMPTY;
  }
  return cleaned;
}

// ── Who / which class the row is about ───────────────────────────────────

// Keys that carry a human student/applicant name, in both spellings.
//
// ⚠ A BARE `name` IS NOT HERE, on purpose. `section.create` wrote the new
// class's name under `name` for years, and reading it as a student put
// "Student: Diligence" on the log. A bare `name` renders as "Name: …" now.
const NAME_KEYS = [
  'studentName',
  'student_name',
  'enroleeFullName',
  'fullName',
] as const;

const STUDENT_NUMBER_KEYS = ['studentNumber', 'student_number'] as const;
const ENROLEE_NUMBER_KEYS = ['enroleeNumber', 'enrolee_number'] as const;

/**
 * Keys the lead renders, so the generic fallback never prints them a second
 * time as "Student no.: …".
 */
const IDENTITY_KEYS = new Set<string>([
  ...NAME_KEYS,
  ...STUDENT_NUMBER_KEYS,
  ...ENROLEE_NUMBER_KEYS,
  'section_name',
  'sectionName',
  'level_label',
  'levelLabel',
  'level_code',
  'term_label',
  'termLabel',
  'term_number',
  'termNumber',
  'subject_name',
  'subject_code',
]);

function firstStr(
  ctx: Record<string, unknown>,
  keys: readonly string[]
): string {
  for (const k of keys) {
    const v = str(ctx[k]);
    if (v) return v;
  }
  return '';
}

// Returns the first non-empty human name in a context, or '' when none.
function nameFromContext(ctx: Record<string, unknown>): string {
  return firstStr(ctx, NAME_KEYS);
}

// Student-centric lead segment for templates: prefer the human name; otherwise
// fall back to a relabeled "Student no. {n}" / "Application no. {n}". Returns ''
// when neither is available (template then leads with its own first part).
function studentLead(ctx: Record<string, unknown>): string {
  const name = nameFromContext(ctx);
  if (name) return name;
  const sn = firstStr(ctx, STUDENT_NUMBER_KEYS);
  if (sn) return `Student no. ${sn}`;
  const en = firstStr(ctx, ENROLEE_NUMBER_KEYS);
  if (en) return `Application no. ${en}`;
  return '';
}

/**
 * "Ana Reyes · Diligence (Primary 4) · Mathematics · Term 2" — whatever of it
 * the row carries, minus whatever `shown` (the rest of the line) already says.
 */
function contextLead(
  action: string,
  ctx: Record<string, unknown>,
  shown: string
): string {
  const parts: string[] = [];

  const name = nameFromContext(ctx);
  if (name) {
    if (!shown.includes(name)) parts.push(name);
  } else {
    const sn = firstStr(ctx, STUDENT_NUMBER_KEYS);
    const en = firstStr(ctx, ENROLEE_NUMBER_KEYS);
    if (sn) {
      if (!shown.includes(sn)) parts.push(`Student no. ${sn}`);
    } else if (en && !shown.includes(en)) {
      parts.push(`Application no. ${en}`);
    }
  }

  const section = str(ctx.section_name) || str(ctx.sectionName);
  const level = str(ctx.level_label) || str(ctx.levelLabel);
  if (section) {
    if (!shown.includes(section)) {
      parts.push(
        level && !section.includes(level) ? `${section} (${level})` : section
      );
    }
  } else if (level && !shown.includes(level)) {
    parts.push(level);
  }

  const subjectName = str(ctx.subject_name);
  const subjectCode = str(ctx.subject_code);
  const subject = subjectName || subjectCode;
  if (
    subject &&
    !shown.includes(subject) &&
    !(subjectCode && shown.includes(subjectCode))
  ) {
    parts.push(subject);
  }

  // A term row names its own term, sometimes in the school's own words.
  if (!action.startsWith('ay.')) {
    const term =
      str(ctx.term_label) ||
      str(ctx.termLabel) ||
      termLabel(ctx.term_number ?? ctx.termNumber);
    if (term && !shown.includes(term)) parts.push(term);
  }

  return parts.join(SEP);
}

// ── A write that stopped half-way ────────────────────────────────────────

// What each `failed_step` a writer records means, in words.
const STEP_LABELS: Record<string, string> = {
  events_insert: 'copying the events',
  rollup: 'updating the attendance totals',
  recompute: 'recalculating the grades',
  recompute_grade: "recalculating the student's grade",
  seed_entries: 'adding the students to the sheet',
  lock: 'locking the sheets',
  outreach_insert: 'recording the follow-up',
  storage_upload: 'uploading the file',
  document_update: 'updating the document record',
  no_document_row: "finding this student's document record",
  application_metadata: 'saving the passport or pass details',
  delete_section: 'removing the class',
  admissions_withdrawal_cascade: 'updating the admissions record',
  admissions_reenrolment_cascade: 'updating the admissions record',
  attach_subjects: 'attaching the subjects',
  attach_track_subjects: "attaching the track's subjects",
  repoint_waiting_requests: 'moving waiting requests to the new approvers',
  approval_rule: 'changing the approval rule',
  move: 'moving the step',
  rename: 'renaming the step',
  add_permissions: 'adding permissions',
  insert: 'saving the new report mapping',
  seed_term: 'setting up school days for a term',
  calendar_resync: 'updating the school days',
  roster_sync: 'adding the student to the class list',
  section_students_update: 'taking the student off the class list',
  admissions_class_mirror: 'updating the class on the admissions record',
  students_name_sync: 'copying the name to the class lists',
  approval_ladder: 'setting up the approval steps',
  status_projection: "updating the declaration's status",
  student_insert: 'adding new students',
  student_update: 'updating student names',
  enrollment_insert: 'adding students to classes',
  enrollment_withdraw: 'withdrawing students',
  enrollment_reactivate: 'bringing students back onto class lists',
  plan: 'working out the changes',
  insert_returned_fewer_rows: 'saving every assignment',
};

function stepLabel(step: string): string {
  return STEP_LABELS[step] ?? humanizeKey(step).toLowerCase();
}

function partialWarning(ctx: Record<string, unknown>): string {
  const step = str(ctx.failed_step) || str(ctx.failedStep);
  const partial = boolish(ctx.partial);
  const bits: string[] = [];
  if (partial === true) {
    bits.push(
      step
        ? `Only partly saved — stopped at: ${stepLabel(step)}`
        : boolish(ctx.projection_failed) === true
          ? "Only partly saved — stopped at: updating the request's status"
          : 'Only partly saved'
    );
  } else if (partial === false && step) {
    bits.push(`Not saved — failed at: ${stepLabel(step)}`);
  }
  if (boolish(ctx.grade_audit_log_failed) === true) {
    bits.push('the grade history copy was not saved');
  }
  return bits.join(SEP);
}

// ── Per-action templates ───────────────────────────────────────────────────

function templateSummary(
  action: string,
  ctx: Record<string, unknown>
): string | null {
  switch (action) {
    // Grade entry / totals / correction --------------------------------------
    case 'entry.update':
    case 'totals.update':
    case 'grade_correction': {
      const parts: string[] = [];
      const field = str(ctx.field);
      if (field === 'weights') {
        const o = weightsText(ctx.old);
        const n = weightsText(ctx.new);
        parts.push(diffText('Weights', o, n) || 'Weights');
        const scope = str(ctx.scope);
        if (scope) parts.push(scope);
      } else if (field) {
        if (boolish(ctx.cleared_by_slot_removal) === true) {
          const o = renderValue(field, ctx.old);
          parts.push(
            `${fieldLabel(field)}: ${o || EMPTY}${ARROW}blank (activity removed)`
          );
        } else {
          const diff = scalarDiff(ctx.old, ctx.new, field);
          parts.push(diff ?? fieldLabel(field));
        }
      }
      if (boolish(ctx.no_op) === true) parts.push('already at that value');
      const lock = boolish(ctx.was_locked);
      if (lock === true) parts.push('post-lock edit');
      else if (lock === false) parts.push('pre-lock edit');
      const corr = labelFor('correction_reason', ctx.correction_reason);
      if (corr) parts.push(corr);
      const why = plainStr(ctx.correction_justification);
      if (why) parts.push(why);
      const ref = str(ctx.approval_reference);
      if (ref) parts.push(`ref ${ref}`);
      return joinParts(parts);
    }

    // Grade-change request lifecycle -----------------------------------------
    case 'grade_change_requested':
    case 'grade_change_approved':
    case 'grade_change_rejected':
    case 'grade_change_cancelled':
    case 'grade_change_applied':
    case 'grade_change_undo_rejection': {
      const parts: string[] = [];
      // ── One step of an ordered approval (migration 144) ────────────────
      //
      // Every yes on the ladder is logged as `grade_change_approved`, and the
      // action label alone would read "Grade change approved" for step 1 of 3.
      // `final: false` marks a step, so the line opens by saying which one —
      // the change is not approved until the last step is.
      const stepOrder = numish(ctx.stage_order);
      const closedByStepEdit = str(ctx.via) === 'repoint';
      // ⚠ NOBODY CLICKED (migrations 145 and 146). The actor on this row is
      // the admin who changed the step's people or rule, and the step finished
      // because its new terms were already met. "Fully approved" beside the
      // admin's name would say the admin approved it; this names the approval
      // it actually finished on. Checked first for that reason.
      if (action === 'grade_change_approved' && closedByStepEdit) {
        const lastBy = str(ctx.final_approver_email);
        const lastByText = lastBy ? ` (last approval by ${lastBy})` : '';
        parts.push(
          boolish(ctx.final) === true
            ? `Grade change request finished after an approver change${lastByText}`
            : stepOrder != null
              ? `Step ${stepOrder} of a grade change request finished after an approver change${lastByText}`
              : `A step of a grade change request finished after an approver change${lastByText}`
        );
      } else if (
        // ⚠ 'recorded' (migration 145) is a yes on a step that needs everyone,
        // and the step has NOT moved. Checked before `final`: it is also
        // `final: false`, and "Approved step 2" alone would claim the step was
        // carried.
        action === 'grade_change_approved' &&
        str(ctx.outcome) === 'recorded'
      ) {
        parts.push(
          stepOrder != null
            ? `Approved step ${stepOrder} of a grade change request (waiting on others)`
            : 'Approved one step of a grade change request (waiting on others)'
        );
      } else if (
        action === 'grade_change_approved' &&
        boolish(ctx.final) === false
      ) {
        parts.push(
          stepOrder != null
            ? `Approved step ${stepOrder} of a grade change request`
            : 'Approved one step of a grade change request'
        );
      } else if (
        action === 'grade_change_approved' &&
        boolish(ctx.final) === true
      ) {
        parts.push(
          stepOrder != null && stepOrder > 1
            ? `Approved the last step (step ${stepOrder})`
            : 'Fully approved'
        );
      } else if (action === 'grade_change_rejected' && stepOrder != null) {
        parts.push(`Turned down at step ${stepOrder}`);
      }
      if (str(ctx.flow) === 'markbook.grade_change_aeb') {
        parts.push('Academic and Examination Board');
      }
      const field = str(ctx.field);
      if (field) {
        // `current` is the value on the sheet when the request was filed;
        // `proposed` what the teacher asked for. Older rows carried
        // `current_value` / `proposed_value`, or `old` / `new`.
        const label = fieldLabel(field, ctx.slot_index);
        const o = renderValue(
          field,
          ctx.current ?? ctx.current_value ?? ctx.old
        );
        const n = renderValue(
          field,
          ctx.proposed ?? ctx.proposed_value ?? ctx.new
        );
        parts.push(diffText(label, o, n) || label);
      }
      const cat = labelFor('reason_category', ctx.reason_category);
      if (cat) parts.push(cat);
      const corr = labelFor('correction_reason', ctx.correction_reason);
      if (corr) parts.push(corr);
      // Rich text — every one of these is typed in the formatting editor. The
      // teacher's reason for asking, then the approver's note on the decision
      // (`decision_note` is what the decision routes write; `rejection_reason`
      // and `reason` are older rows).
      const justification = plainStr(ctx.justification);
      if (justification) parts.push(justification);
      const reason = plainStr(
        ctx.decision_note ?? ctx.rejection_reason ?? ctx.reason
      );
      if (reason) parts.push(reason);
      const ref = str(ctx.approval_reference);
      if (ref) parts.push(`ref ${ref}`);
      return joinParts(parts);
    }

    // Parent-filed declarations ----------------------------------------------
    //
    // ⚠ The words are missing on purpose. Neither the parent's note nor the
    // approver's reason is in `context` at all — see migration 109's rule, kept
    // by 125 and 126 — so there is nothing to render but the facts of the
    // decision: whose class, which days, which step, and whether a certificate
    // was attached (`ex_reason` is already logged the same way by the daily
    // attendance writer, so this is the existing line, not a new one).
    case 'declaration.approve':
    case 'declaration.reject':
    case 'declaration.file':
    case 'declaration.file.staff':
    case 'declaration.evidence.attach': {
      const parts: string[] = [];
      const section = str(ctx.section_name);
      if (section) parts.push(section);
      const from = fmtMaybeDate(ctx.start_date);
      const to = fmtMaybeDate(ctx.end_date);
      if (from && to) parts.push(from === to ? from : `${from}${ARROW}${to}`);
      else if (from) parts.push(from);
      const type = str(ctx.declaration_type);
      if (type) parts.push(type === 'travel' ? 'travel' : 'absence');
      if (boolish(ctx.with_medical) === true) parts.push('with certificate');

      // ── A parent's filing, not yet decided ─────────────────────────────
      if (action === 'declaration.file') {
        if (str(ctx.filed_by) === 'parent') parts.push('filed by a parent');
        pushEvidenceKind(parts, ctx.evidence_kind);
        if (boolish(ctx.parent_note_present) === true)
          parts.push('parent added a note');
        const children = numish(ctx.children_in_filing);
        if (children !== null && children > 1)
          parts.push(`filed for ${children} children together`);
        if (boolish(ctx.approval_steps_configured) === false)
          parts.push(
            'no approval steps are set up, so nobody can approve it yet'
          );
        if (boolish(ctx.rollback_failed) === true)
          parts.push(
            'the parent was asked to try again, but this filing stayed'
          );
        return joinParts(parts);
      }

      // ── The school recording its own evidence ──────────────────────────
      //
      // Staff attaching a medical certificate the parent could not file
      // (Mr Ace: "if the parent wasn't able to"). The row lands already
      // approved with no approval ladder behind it, so there is no step and
      // no outcome to name — and, crucially, no queue entry and no Activity
      // event either, because both are derived from
      // `approval_request_stages`. THIS LINE IS THEREFORE THE ONLY PLACE THE
      // action is visible to anybody, which is why it says who did it in
      // words rather than leaving the reader to infer it from a blank stage.
      //
      // ⚠ Presence only, never the file or the link — migration 109's rule,
      // kept by 125 and 126. `audit_log` is readable by every
      // is_registrar_or_above() user and can never be corrected, and a URL to
      // a child's medical certificate is exactly what that rule is about.
      if (
        boolish(ctx.recorded_by_school) === true ||
        action === 'declaration.file.staff' ||
        action === 'declaration.evidence.attach'
      ) {
        // ⚠ ATTACHING TO A FILING IS NOT CREATING ONE, and this line is the
        // only place either is visible. Without the distinction a certificate
        // added to a parent's pending request would read exactly like the
        // office recording a fresh absence — the same action name, the same
        // child, the same days.
        // ⚠ REPLACING IS ITS OWN SENTENCE. A certificate the school already
        // held was overwritten and the old file is referenced by nothing
        // afterwards, so this line is the only surviving record that it
        // happened at all. "added" would describe a day that had none.
        parts.push(
          boolish(ctx.replaced_existing) === true
            ? 'certificate on the parent’s filing replaced'
            : boolish(ctx.attached_to_existing) === true ||
                action === 'declaration.evidence.attach'
              ? 'certificate added to the parent’s filing'
              : 'recorded by the school office'
        );
        const replacedKind = str(ctx.replaced_evidence_kind);
        if (replacedKind === 'file')
          parts.push('an uploaded certificate was replaced');
        else if (replacedKind === 'link')
          parts.push('a certificate link was replaced');
        else if (replacedKind === 'both')
          parts.push('an uploaded certificate and a link were replaced');
        pushEvidenceKind(parts, ctx.evidence_kind);
        if (
          action === 'declaration.evidence.attach' &&
          str(ctx.status) === 'pending'
        ) {
          parts.push('the declaration is still waiting for approval');
        }
        return joinParts(parts);
      }
      const stage = str(ctx.stage_label);
      if (stage) parts.push(stage);
      const outcome = str(ctx.outcome);
      if (str(ctx.via) === 'repoint') {
        // Nobody clicked (migrations 145 and 146): the actor is the admin who
        // changed the step's people or rule, and the step finished because its
        // new terms were already met. Named for the approval it finished on,
        // so the line never reads as the admin having approved the absence.
        const lastBy = str(ctx.final_approver_email);
        const lastByText = lastBy ? ` (last approval by ${lastBy})` : '';
        parts.push(
          outcome === 'completed'
            ? `finished after an approver change${lastByText}`
            : `step finished after an approver change${lastByText}`
        );
      } else if (outcome === 'advanced') parts.push('moved to the next step');
      else if (outcome === 'completed') parts.push('fully approved');
      // Migration 145 — a yes on a step that needs everyone, still waiting.
      else if (outcome === 'recorded') parts.push('waiting on others');
      if (boolish(ctx.note_present) === true) parts.push('note attached');
      const days = numish(ctx.register_days_written);
      if (days !== null && days > 0)
        parts.push(`${plural(days, 'day')} marked Excused on the register`);
      if (boolish(ctx.register_write_failed) === true)
        parts.push('the attendance register was not updated');
      return joinParts(parts);
    }

    // Ordered approval steps -------------------------------------------------
    case 'approval_stage.create':
    case 'approval_stage.update':
    case 'approval_stage.delete':
    case 'approval_stage.approver.assign':
    case 'approval_stage.approver.revoke': {
      const parts: string[] = [];
      const flow = flowLabel(ctx);
      if (flow) parts.push(flow);
      const stage = str(ctx.stage_label);
      const order = numish(ctx.stage_order);
      if (stage) parts.push(order !== null ? `Step ${order}: ${stage}` : stage);
      else if (order !== null) parts.push(`Step ${order}`);
      const person = personText(ctx);
      if (person) parts.push(person);
      const scope =
        str(ctx.applies_to_label) ||
        (APPROVER_LEVEL_SCOPE_LABELS as Record<string, string>)[
          str(ctx.applies_to_level_type)
        ] ||
        '';
      if (scope) parts.push(scope);
      const moved = str(ctx.move);
      if (moved) {
        if (boolish(ctx.moved) === false) parts.push('could not be moved');
        else parts.push(moved === 'up' ? 'moved earlier' : 'moved later');
      }
      const prevLabel = str(ctx.previous_label);
      const renamed = str(ctx.new_label);
      if (renamed && prevLabel && prevLabel !== renamed)
        parts.push(`renamed from ${prevLabel} to ${renamed}`);
      else if (renamed) parts.push(`renamed to ${renamed}`);
      const rule = ruleLabel(ctx.approval_rule);
      const prevRule = ruleLabel(ctx.previous_approval_rule);
      if (rule) parts.push(diffText('Rule', prevRule, rule));
      const repointed = numish(ctx.repointed_waiting);
      if (repointed !== null && repointed > 0)
        parts.push(`${plural(repointed, 'waiting request')} brought in line`);
      return joinParts(parts);
    }

    // The older pooled change-request approvers ------------------------------
    case 'approver.assign':
    case 'approver.revoke': {
      const parts: string[] = [];
      const person = personText(ctx);
      if (person) parts.push(person);
      const flow =
        str(ctx.flow_label) ||
        (APPROVER_FLOW_LABELS as Record<string, string>)[str(ctx.flow)] ||
        '';
      if (flow) parts.push(flow);
      return joinParts(parts);
    }

    // Attendance daily -------------------------------------------------------
    case 'attendance.daily.update':
    case 'attendance.daily.correct':
    case 'attendance.update': {
      const parts: string[] = [];
      const section = str(ctx.section_name ?? ctx.sectionName ?? ctx.section);
      if (section) parts.push(section);
      const date = fmtMaybeDate(ctx.date);
      if (date) parts.push(date);
      const before = labelFor(
        'status',
        ctx.prior_status ?? ctx.old_status ?? ctx.before
      );
      const after = labelFor(
        'status',
        ctx.status ?? ctx.new_status ?? ctx.after
      );
      // A CLEARED MARK — migration 134. The writer sends `status` as a
      // present key with an explicit `null`, which is what separates "the day
      // was returned to unmarked" from "this row records no status at all":
      // an absent key reads as `undefined`, a clear reads as `null`.
      //
      // ⚠ It needs its own sentence because `str(null)` is '', so `after` is
      // empty and the two branches below would BOTH fall through — the line
      // would name the class and the date and then say nothing about what
      // happened. Printing the raw value instead is not an option: "null" is
      // not a word a school administrator should ever be shown.
      const cleared =
        ctx.status === null && ctx.new_status == null && ctx.after == null;
      if (cleared) {
        // "was Absent" and not an arrow. An arrow points at what the day says
        // now, and a cleared day says nothing — `Absent → ` would read as an
        // unfinished sentence.
        parts.push(before ? `Mark cleared (was ${before})` : 'Mark cleared');
      } else if (before && after && before !== after)
        parts.push(`${before}${ARROW}${after}`);
      else if (after) parts.push(after);
      const ex = labelFor('ex_reason', ctx.ex_reason ?? ctx.exReason);
      if (ex) parts.push(ex);
      // Presence only — the note's words never reach the log (migration 109).
      if (boolish(ctx.ex_note_changed) === true)
        parts.push(
          boolish(ctx.ex_note_present) === true
            ? 'note changed'
            : 'note removed'
        );
      else if (boolish(ctx.ex_note_present) === true)
        parts.push('note attached');
      if (str(ctx.source) === 'declaration_approval')
        parts.push('from an approved declaration');
      return joinParts(parts);
    }

    // School calendar upsert -------------------------------------------------
    case 'attendance.calendar.upsert': {
      const parts: string[] = [];
      const audience = labelFor('audience', ctx.audience);
      if (audience) parts.push(audience);
      if (str(ctx.action) === 'autofill_weekdays') {
        const start = fmtMaybeDate(ctx.start);
        const end = fmtMaybeDate(ctx.end);
        parts.push(
          start && end
            ? `Weekdays filled in as school days, ${start}${ARROW}${end}`
            : 'Weekdays filled in as school days'
        );
        const inserted = numish(ctx.inserted);
        if (inserted !== null) parts.push(`${plural(inserted, 'day')} added`);
        return joinParts(parts);
      }
      const diffs = Array.isArray(ctx.diffs) ? ctx.diffs : null;
      if (diffs && diffs.length) {
        const rendered = diffs
          .slice(0, LIST_CAP)
          .map((d) => calendarDayChange(isRecord(d) ? d : {}))
          .filter(Boolean);
        if (rendered.length) {
          parts.push(rendered.join(', '));
          if (diffs.length > LIST_CAP)
            parts.push(`+${diffs.length - LIST_CAP} more`);
        }
      } else {
        const from = labelFor('day_type', ctx.old_day_type);
        const to = labelFor('day_type', ctx.new_day_type);
        const date = fmtMaybeDate(ctx.date);
        if (date) parts.push(date);
        if (from && to) parts.push(`${from}${ARROW}${to}`);
        else if (to) parts.push(to);
      }
      return joinParts(parts);
    }

    case 'attendance.calendar.delete': {
      const parts: string[] = [];
      const date = fmtMaybeDate(ctx.date);
      if (date) parts.push(date);
      const audience = labelFor('audience', ctx.audience);
      if (audience) parts.push(audience);
      if (boolish(ctx.removed) === false) {
        parts.push('there was nothing to remove');
        return joinParts(parts);
      }
      const type = labelFor('day_type', ctx.before_day_type);
      const label = str(ctx.before_label);
      if (type || label)
        parts.push(
          `was ${[type, label ? `“${label}”` : ''].filter(Boolean).join(' ')}`
        );
      if (boolish(ctx.before_hbl_overlay) === true)
        parts.push('home-based learning');
      return joinParts(parts);
    }

    case 'attendance.calendar.autoseed': {
      const parts: string[] = [];
      const ay = str(ctx.ayCode ?? ctx.ay_code);
      if (ay) parts.push(ay);
      const inserted = numish(ctx.inserted);
      if (inserted !== null)
        parts.push(`${plural(inserted, 'school day')} added`);
      const seeded = recArray(ctx.terms_seeded)
        .map((t) => {
          const term = termLabel(t.term_number);
          const n = numish(t.inserted);
          return term && n !== null ? `${term}: ${n}` : term;
        })
        .filter(Boolean);
      if (seeded.length) parts.push(listText(seeded, LIST_CAP));
      else {
        const terms = numish(ctx.terms);
        if (terms !== null) parts.push(`across ${plural(terms, 'term')}`);
      }
      const failedTerm = termLabel(ctx.failed_term_number);
      if (failedTerm) parts.push(`${failedTerm} was not set up`);
      return joinParts(parts);
    }

    case 'attendance.calendar.copy_from_prior_ay': {
      const parts: string[] = [];
      const days = numish(ctx.dayTypeRowsCopied);
      const events = numish(ctx.eventsCopied);
      const copied = [
        days !== null ? plural(days, 'day') : '',
        events !== null ? plural(events, 'event') : '',
      ].filter(Boolean);
      if (copied.length) parts.push(`${copied.join(' and ')} copied`);
      if (boolish(ctx.markTentative) === true)
        parts.push('events marked tentative');
      const overwritten = recArray(ctx.overwrittenDays);
      if (overwritten.length) {
        const lines = overwritten.map((d) => calendarDayChange(d));
        parts.push(
          `${plural(overwritten.length, 'day')} replaced: ${listText(lines)}`
        );
      }
      const eventsRequested = numish(ctx.eventsRequested);
      if (eventsRequested !== null && boolish(ctx.partial) === true)
        parts.push(`${plural(eventsRequested, 'event')} not copied`);
      return joinParts(parts);
    }

    // Calendar events --------------------------------------------------------
    case 'attendance.event.create':
    case 'attendance.event.update':
    case 'attendance.event.delete': {
      const parts: string[] = [];
      if (
        action === 'attendance.event.update' &&
        (isRecord(ctx.before) || isRecord(ctx.after))
      ) {
        const b = isRecord(ctx.before) ? ctx.before : {};
        const a = isRecord(ctx.after) ? ctx.after : {};
        const label = str(a.label) || str(b.label) || str(ctx.label);
        if (label) parts.push(label);
        if (boolish(ctx.updated) === false) {
          parts.push('no event found, nothing changed');
          return joinParts(parts);
        }
        const bLabel = str(b.label);
        const aLabel = str(a.label);
        if (bLabel && aLabel && bLabel !== aLabel)
          parts.push(`renamed from “${bLabel}”`);
        const bRange = dateRange(b.startDate, b.endDate);
        const aRange = dateRange(a.startDate, a.endDate);
        if (aRange) parts.push(diffText('', bRange, aRange));
        const bCat = labelFor('category', b.category);
        const aCat = labelFor('category', a.category);
        if (aCat && bCat !== aCat) parts.push(diffText('', bCat, aCat));
        const bWho = eventAudienceText(b);
        const aWho = eventAudienceText(a);
        if (aWho && bWho !== aWho) parts.push(diffText('For', bWho, aWho));
        const bTent = boolish(b.tentative);
        const aTent = boolish(a.tentative);
        if (aTent !== bTent && aTent !== null)
          parts.push(aTent ? 'now tentative' : 'no longer tentative');
        return joinParts(parts);
      }
      if (
        action === 'attendance.event.delete' &&
        boolish(ctx.removed) === false
      )
        return 'no event found, nothing removed';
      const label = str(ctx.label);
      if (label) parts.push(label);
      const category = labelFor('category', ctx.category);
      if (category) parts.push(category);
      const start = fmtMaybeDate(ctx.start_date ?? ctx.startDate);
      const end = fmtMaybeDate(ctx.end_date ?? ctx.endDate);
      if (start && end && start !== end) parts.push(`${start}${ARROW}${end}`);
      else if (start) parts.push(start);
      const who = eventAudienceText(ctx);
      if (who) parts.push(`for ${who}`);
      if (boolish(ctx.tentative) === true) parts.push('tentative');
      return joinParts(parts);
    }

    // Document approve / reject ----------------------------------------------
    case 'sis.document.approve':
    case 'sis.document.reject': {
      const parts: string[] = [];
      const slot = docLabel(ctx);
      if (slot) parts.push(slot);
      const before = str(ctx.prior_status);
      const status = str(ctx.new_status ?? ctx.status);
      if (status) parts.push(diffText('', before, status));
      // Rich text — `rejectionReason` is typed in the formatting editor on the
      // document-validation actions.
      const reason = plainStr(ctx.rejection_reason ?? ctx.reason);
      if (reason) parts.push(reason);
      if (boolish(ctx.notified) === true) parts.push('parent emailed');
      return joinParts(parts);
    }

    // P-Files ----------------------------------------------------------------
    case 'pfile.upload': {
      const parts: string[] = [];
      const slot = docLabel(ctx);
      if (slot) parts.push(slot);
      const files = numish(ctx.fileCount);
      if (files !== null && files > 1)
        parts.push(`${files} files merged into one`);
      if (boolish(ctx.replaced) === true)
        parts.push('replaced the previous file');
      const status = diffText(
        'Status',
        str(ctx.priorStatus),
        str(ctx.newStatus)
      );
      if (status && str(ctx.priorStatus) !== str(ctx.newStatus))
        parts.push(status);
      const expiry = diffText(
        'Expires',
        fmtMaybeDate(ctx.priorExpiry),
        fmtMaybeDate(ctx.expiryDate)
      );
      if (expiry) parts.push(expiry);
      if ('priorPassType' in ctx || str(ctx.passType)) {
        const pass = diffText(
          'Pass type',
          str(ctx.priorPassType),
          str(ctx.passType)
        );
        if (pass) parts.push(pass);
      }
      if ('priorPassportNumber' in ctx) {
        if (str(ctx.priorPassportNumber) !== str(ctx.passportNumber))
          parts.push('passport number changed');
      } else if (str(ctx.passportNumber)) {
        parts.push('passport number recorded');
      }
      if (boolish(ctx.archiveFailed) === true)
        parts.push('the old file could not be kept as a past version');
      if (boolish(ctx.revisionFailed) === true)
        parts.push('the past version was not listed');
      const note = plainStr(ctx.note);
      if (note) parts.push(note);
      return joinParts(parts);
    }

    case 'pfile.mark.promised':
    case 'admissions.mark.promised': {
      const parts: string[] = [];
      const slot = docLabel(ctx);
      if (slot) parts.push(slot);
      const before = str(ctx.prior_status);
      const after = str(ctx.new_status) || 'To follow';
      parts.push(diffText('', before, after));
      const until = fmtMaybeDate(ctx.promised_until);
      if (until) parts.push(`promised by ${until}`);
      const note = plainStr(ctx.note);
      if (note) parts.push(note);
      return joinParts(parts);
    }

    case 'pfile.reminder.sent':
    case 'admissions.reminder.sent': {
      const parts: string[] = [];
      const slot = docLabel(ctx);
      if (slot) parts.push(slot);
      const to = str(ctx.to);
      const cc = strArray(ctx.cc);
      if (to)
        parts.push(
          `emailed to ${to}${cc.length ? ` (copy to ${listText(cc, 2)})` : ''}`
        );
      const failed = numish(ctx.failed);
      if (failed !== null && failed > 0)
        parts.push('the email could not be sent');
      else if (!to) {
        const sent = numish(ctx.sent);
        if (sent !== null) parts.push(`${plural(sent, 'email')} sent`);
      }
      return joinParts(parts);
    }

    case 'pfile.reminder.bulk':
    case 'admissions.reminder.bulk': {
      const parts: string[] = [];
      const emailed = recArray(ctx.emailed);
      const notEmailed = recArray(ctx.not_emailed);
      if (Array.isArray(ctx.emailed) || Array.isArray(ctx.not_emailed)) {
        const names = emailed.map((e) => {
          const who =
            nameFromContext(e) ||
            firstStr(e, STUDENT_NUMBER_KEYS) ||
            firstStr(e, ENROLEE_NUMBER_KEYS);
          const doc = docLabel(e);
          return who && doc ? `${who} (${doc})` : who || doc;
        });
        parts.push(
          emailed.length
            ? `${plural(emailed.length, 'reminder')} emailed: ${listText(names)}`
            : 'no reminders emailed'
        );
        if (notEmailed.length) {
          const counts = countBy(
            notEmailed.map(
              (n) =>
                REMINDER_SKIP_LABELS[str(n.reason)] ??
                humanizeKey(str(n.reason) || 'other').toLowerCase()
            )
          );
          parts.push(`${notEmailed.length} not emailed (${counts})`);
        }
        return joinParts(parts);
      }
      const sent = numish(ctx.sent);
      if (sent !== null) parts.push(`${plural(sent, 'email')} sent`);
      const failed = numish(ctx.failed);
      if (failed !== null && failed > 0) parts.push(`${failed} failed`);
      const skipped: string[] = [];
      for (const [key, label] of [
        ['skipped_cooldown', 'reminded recently'],
        ['skipped_not_enrolled', 'not enrolled'],
        ['skipped_no_recipients', 'no parent email on file'],
        ['skipped_not_actionable', 'nothing to chase'],
      ] as const) {
        const n = numish(ctx[key]);
        if (n !== null && n > 0) skipped.push(`${label} ×${n}`);
      }
      if (skipped.length) parts.push(`skipped: ${skipped.join(', ')}`);
      return joinParts(parts);
    }

    case 'sis.documents.auto-expire':
    case 'sis.documents.auto-revive': {
      const expire = action === 'sis.documents.auto-expire';
      const verb = expire ? 'expired' : 'valid again';
      const flips = recArray(ctx.flips);
      let total = 0;
      const bySlot = new Map<string, number>();
      if (flips.length) {
        for (const f of flips) {
          const key = str(f.slot_key);
          bySlot.set(key, (bySlot.get(key) ?? 0) + 1);
          total += 1;
        }
      } else {
        const counts = isRecord(ctx.flippedBySlot)
          ? ctx.flippedBySlot
          : isRecord(ctx.revivedBySlot)
            ? ctx.revivedBySlot
            : {};
        for (const [key, v] of Object.entries(counts)) {
          const n = numish(v);
          if (n !== null && n > 0) {
            bySlot.set(key, n);
            total += n;
          }
        }
        const stated = numish(ctx.flippedCount ?? ctx.revivedCount);
        if (stated !== null) total = stated;
      }
      if (total === 0 && bySlot.size === 0) return null;
      const breakdown = [...bySlot.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([key, n]) => `${slotLabelForKey(key)} ×${n}`);
      const parts = [
        `${plural(total, 'document')} ${verb}${breakdown.length ? `: ${listText(breakdown, LIST_CAP)}` : ''}`,
      ];
      const students = flips.length
        ? new Set(flips.map((f) => str(f.enrolee_number))).size
        : strArray(ctx.enroleeNumbers).length;
      if (students > 0) parts.push(`${plural(students, 'student')}`);
      return joinParts(parts);
    }

    // Publications -----------------------------------------------------------
    case 'publication.create':
    case 'publication.delete': {
      const parts: string[] = [];
      const term = str(
        ctx.term_label ?? ctx.term ?? termLabel(ctx.term_number)
      );
      if (term) parts.push(term);
      const section = str(ctx.section_name ?? ctx.section);
      if (section) parts.push(section);
      const from = fmtMaybeDateTime(
        ctx.publish_from ?? ctx.window_start ?? ctx.starts_at ?? ctx.from
      );
      const to = fmtMaybeDateTime(
        ctx.publish_until ?? ctx.window_end ?? ctx.ends_at ?? ctx.to
      );
      const range = from && to ? `${from}${ARROW}${to}` : from;
      if (action === 'publication.delete') {
        if (range) parts.push(`was visible to parents ${range}`);
        return joinParts(parts);
      }
      if (range) parts.push(`visible to parents ${range}`);
      const pf = fmtMaybeDateTime(ctx.previous_publish_from);
      const pu = fmtMaybeDateTime(ctx.previous_publish_until);
      const prevRange = pf && pu ? `${pf}${ARROW}${pu}` : pf;
      if (prevRange && prevRange !== range) parts.push(`was ${prevRange}`);
      if (boolish(ctx.first_publish) === true)
        parts.push('first time published');
      const notification = isRecord(ctx.notification) ? ctx.notification : null;
      const sent = notification ? numish(notification.sent) : null;
      if (sent !== null && sent > 0)
        parts.push(`${plural(sent, 'parent email')} sent`);
      if (boolish(ctx.overridden) === true) {
        const gaps = Array.isArray(ctx.gaps) ? ctx.gaps.length : 0;
        parts.push(
          gaps > 0
            ? `published with ${plural(gaps, 'readiness gap')} overridden`
            : 'published with readiness gaps overridden'
        );
      }
      return joinParts(parts);
    }

    // Enrolment metadata -----------------------------------------------------
    case 'enrolment.metadata.update': {
      if (ctx.lateEnrolleeReverted === true) {
        const reason = str(ctx.revertReason);
        return reason
          ? `Late enrollee reverted to active — ${reason}`
          : 'Late enrollee reverted to active';
      }
      const before = isRecord(ctx.before) ? ctx.before : {};
      const after = isRecord(ctx.after) ? ctx.after : {};
      const parts: string[] = [];
      const fromS = labelFor(
        'enrollment_status',
        before.enrollment_status ?? ctx.prior_status
      );
      const toS = labelFor(
        'enrollment_status',
        after.enrollment_status ?? ctx.status
      );
      if (fromS && toS && fromS !== toS) parts.push(`${fromS}${ARROW}${toS}`);
      else if (toS && 'enrollment_status' in after) parts.push(toS);
      else if (
        toS &&
        !('enrollment_status' in after) &&
        !Object.keys(after).length
      )
        parts.push(toS);

      // ⚠ WHAT `withdrawal_date` MEANS DEPENDS ON WHEN THE ROW WAS WRITTEN.
      // Since migration 163 it is the last day of attendance, entered by the
      // registrar, and those rows always carry `withdrawal_approved_date` in
      // `before`. Older rows stamped the day somebody clicked — calling that a
      // "last day" would state as fact something nobody recorded.
      const modern = 'withdrawal_approved_date' in before;
      for (const key of Object.keys(after)) {
        if (key === 'enrollment_status') continue;
        if (shouldSkipKey(key, after[key])) continue;
        if (valuesEqual(before[key], after[key])) continue;
        const label =
          key === 'withdrawal_date' && !modern
            ? 'Withdrawal date'
            : fieldLabel(key);
        const o = renderValue(key, before[key]);
        const n = renderValue(key, after[key]);
        const text = diffText(label, o, n);
        if (text) parts.push(text);
      }
      if (boolish(ctx.lateEnrolleeTransition) === true)
        parts.push('now a late enrollee');
      return joinParts(parts);
    }

    // Section transfer -------------------------------------------------------
    case 'student.section.transfer': {
      const from = str(ctx.fromSection ?? ctx.from_section ?? ctx.from);
      const to = str(ctx.toSection ?? ctx.to_section ?? ctx.to);
      const fromIdx = numish(ctx.from_index_number);
      const toIdx = numish(ctx.to_index_number);
      const term = str(
        ctx.term_label ??
          ctx.termLabel ??
          ctx.term ??
          termLabel(ctx.termNumber ?? ctx.term_number)
      );
      const parts: string[] = [];
      const lead = studentLead(ctx);
      if (lead) parts.push(lead);
      const fromText = from && fromIdx !== null ? `${from} #${fromIdx}` : from;
      const toText = to && toIdx !== null ? `${to} #${toIdx}` : to;
      if (fromText && toText) parts.push(`${fromText}${ARROW}${toText}`);
      else if (toText) parts.push(toText);
      if (term) parts.push(term);
      if (boolish(ctx.returned_to_previous_section) === true)
        parts.push('returned to a class they had left before');
      return joinParts(parts);
    }

    case 'sis.student.assign_section': {
      const section = str(
        ctx.section_name ?? ctx.sectionName ?? ctx.classSection ?? ctx.section
      );
      const level = str(
        ctx.level_label ??
          ctx.levelLabel ??
          ctx.class_level ??
          ctx.classLevel ??
          ctx.level
      );
      const parts: string[] = [];
      const lead = studentLead(ctx);
      if (lead) parts.push(lead);
      // "Grit (Primary 1)" when both section + level present.
      if (section && level) parts.push(`${section} (${level})`);
      else if (section) parts.push(section);
      else if (level) parts.push(level);
      const idx = numish(ctx.index_number);
      if (idx !== null) parts.push(`index #${idx}`);
      const startBefore = fmtMaybeDate(ctx.enrollment_date_before);
      const startAfter = fmtMaybeDate(ctx.enrollment_date_after);
      if (startAfter && startBefore !== startAfter)
        parts.push(diffText('Start date', startBefore, startAfter));
      if (boolish(ctx.rollback_failed) === true)
        parts.push(
          'the admissions record still shows this class, but the class list does not'
        );
      return joinParts(parts);
    }

    // Withdrawal / re-enrolment cascade --------------------------------------
    case 'student.withdrawal.cascade':
    case 'student.reenrolment.cascade': {
      const parts: string[] = [];
      const lead = studentLead(ctx);
      if (lead) parts.push(lead);
      const status = str(ctx.applicationStatus_after ?? ctx.status);
      if (status) parts.push(status);
      const sections = recArray(ctx.sections)
        .map((s) => {
          const name = str(s.section_name);
          const idx = numish(s.index_number);
          return name && idx !== null ? `${name} #${idx}` : name;
        })
        .filter(Boolean);
      if (sections.length)
        parts.push(
          `${action === 'student.withdrawal.cascade' ? 'taken off' : 'back on'} ${listText(sections)}`
        );
      // Same rule as enrolment.metadata.update: only rows that also carry the
      // approval date recorded a real last day.
      const modern = 'withdrawal_approved_date' in ctx;
      const date = fmtMaybeDate(ctx.withdrawal_date ?? ctx.date);
      if (date)
        parts.push(modern ? `Last day: ${date}` : `Withdrawal date: ${date}`);
      const approved = fmtMaybeDate(ctx.withdrawal_approved_date);
      if (approved) parts.push(`Withdrawal approved: ${approved}`);
      const reason = labelFor('withdrawal_reason', ctx.withdrawal_reason);
      if (reason) parts.push(reason);
      const cleared = fmtMaybeDate(ctx.withdrawal_date_cleared);
      if (cleared) parts.push(`withdrawal dated ${cleared} cleared`);
      if (str(ctx.terminalCascadeSkipped))
        parts.push(
          'the admissions record was already closed and was left as it was'
        );
      return joinParts(parts);
    }

    // Leave allowance updates ------------------------------------------------
    case 'sis.allowance.update':
    case 'sis.vl_allowance.update': {
      const parts: string[] = [];
      const lead = studentLead(ctx);
      if (lead) parts.push(lead);
      const before = numish(ctx.before);
      const after = numish(ctx.after);
      if (before !== null && after !== null && before !== after) {
        parts.push(`${before}${ARROW}${after}`);
      } else if (after !== null) {
        parts.push(String(after));
      }
      return joinParts(parts);
    }

    // House assignment (migration 110) ---------------------------------------
    // The route writes `before_name`/`after_name` alongside the ids precisely
    // so this reads as "Ana Reyes · House 2 → House 3" rather than two uuids.
    case 'sis.house.update': {
      const parts: string[] = [];
      const lead = studentLead(ctx);
      if (lead) parts.push(lead);
      const before = str(ctx.before_name);
      const after = str(ctx.after_name);
      if (before && after) parts.push(`${before}${ARROW}${after}`);
      else if (after) parts.push(after);
      else if (before) parts.push(`${before}${ARROW}none`);
      return joinParts(parts);
    }

    // Student lists ------------------------------------------------------------
    case 'student.sync': {
      const parts: string[] = [];
      const single = str(ctx.change);
      if (single && !Array.isArray(ctx.changes)) {
        parts.push(SYNC_ONE_LABELS[single] ?? humanizeKey(single));
        return joinParts(parts);
      }
      const entries = recArray(ctx.changes).filter((c) => str(c.change));
      const counts: string[] = [];
      for (const [key, label] of SYNC_BULK_KEYS) {
        const n =
          numish(ctx[key]) ??
          (entries.length
            ? entries.filter((e) => str(e.change) === SYNC_BULK_CHANGE[key])
                .length
            : null);
        if (n !== null && n > 0) counts.push(`${n} ${label}`);
      }
      // A run that failed logs what it PLANNED; only `committed` landed.
      const planned = str(ctx.failed_step) ? 'planned: ' : '';
      if (counts.length) parts.push(`${planned}${counts.join(', ')}`);
      else if (
        !entries.length &&
        boolish(ctx.partial) !== true &&
        !str(ctx.failed_step)
      )
        parts.push('nothing to change');
      for (const [change, label] of SYNC_CHANGE_ORDER) {
        const names = entries
          .filter((e) => str(e.change) === change)
          .map((e) => {
            const who = str(e.name) || str(e.student_number);
            if (change === 'renamed') {
              const was = str(e.name_before);
              return was && was !== who ? `${was}${ARROW}${who}` : who;
            }
            const where = str(e.section);
            return where ? `${who} (${where})` : who;
          });
        if (names.length) parts.push(`${label}: ${listText(names)}`);
      }
      const skipped = Array.isArray(ctx.skipped)
        ? ctx.skipped.length
        : numish(ctx.errors);
      if (skipped !== null && skipped > 0)
        parts.push(`${plural(skipped, 'student')} could not be synced`);
      const committed = strArray(ctx.committed);
      if (committed.length)
        parts.push(
          `done before it stopped: ${committed.map(stepLabel).join(', ')}`
        );
      return joinParts(parts);
    }

    case 'sis.student.auto_sync_batch': {
      const parts: string[] = [];
      const total = numish(ctx.total_candidates);
      if (total !== null) parts.push(`${plural(total, 'student')} checked`);
      const byOutcome = isRecord(ctx.by_outcome) ? ctx.by_outcome : {};
      const namesByOutcome = isRecord(ctx.students_by_outcome)
        ? ctx.students_by_outcome
        : {};
      const counts: string[] = [];
      for (const [outcome, v] of Object.entries(byOutcome)) {
        const n = numish(v);
        if (n === null || n === 0) continue;
        const label =
          SYNC_ONE_OUTCOME_LABELS[outcome] ??
          humanizeKey(outcome).toLowerCase();
        const names = recArray(namesByOutcome[outcome])
          .map(
            (s) => str(s.name) || str(s.studentNumber) || str(s.enroleeNumber)
          )
          .filter(Boolean);
        counts.push(
          names.length ? `${n} ${label} (${listText(names)})` : `${n} ${label}`
        );
      }
      if (counts.length) parts.push(counts.join(', '));
      const failures = recArray(ctx.failures);
      if (failures.length) {
        const names = failures
          .map(
            (f) => str(f.name) || str(f.studentNumber) || str(f.enroleeNumber)
          )
          .filter(Boolean);
        parts.push(`could not sync: ${listText(names)}`);
      } else {
        const errors = Array.isArray(ctx.errors) ? ctx.errors.length : 0;
        if (errors > 0 && !counts.some((c) => c.includes('skipped')))
          parts.push(`${plural(errors, 'student')} could not be synced`);
      }
      return joinParts(parts);
    }

    case 'sis.student.export_raw': {
      const parts: string[] = [];
      const rows = numish(ctx.row_count);
      if (rows !== null) parts.push(`${plural(rows, 'student')} downloaded`);
      const columns = Array.isArray(ctx.columns)
        ? ctx.columns.length
        : numish(ctx.columns);
      if (columns !== null) parts.push(`${plural(columns, 'column')}`);
      const ay = str(ctx.ay_code);
      if (ay) parts.push(ay);
      return joinParts(parts);
    }

    case 'sis.family.update': {
      const parts: string[] = [];
      const parent = str(ctx.parent);
      if (parent) parts.push(`${humanizeKey(parent)}'s details`);
      const changes = renderChangeList(ctx.changes);
      if (changes) parts.push(changes);
      return joinParts(parts);
    }

    case 'sis.stage.update': {
      const parts: string[] = [];
      const stageKey = str(ctx.stage);
      const stage =
        str(ctx.stage_label) ||
        (STAGE_LABELS as Record<string, string>)[stageKey] ||
        (stageKey ? humanizeKey(stageKey) : '');
      const changes = recArray(ctx.changes);
      const isStatus = (f: string) => /Status$/.test(f);
      const isRemarks = (f: string) => /Remarks$/.test(f);
      const isTerminal = (f: string) => /Terminal(Reason|Notes)$/.test(f);
      const status = changes.find((c) => isStatus(str(c.field)));
      if (status) {
        parts.push(
          diffText(stage || 'Status', str(status.from), str(status.to)) ||
            `${stage || 'Status'} cleared`
        );
      } else if (stage) {
        parts.push(stage);
      }
      const reasonKey =
        str(ctx.terminalReason) ||
        str(changes.find((c) => /TerminalReason$/.test(str(c.field)))?.to);
      const reason =
        (APPLICATION_TERMINAL_REASON_LABELS as Record<string, string>)[
          reasonKey
        ] ?? (reasonKey ? humanizeKey(reasonKey) : '');
      if (reason) parts.push(`Reason: ${reason}`);
      const notes =
        plainStr(ctx.terminalNotes) ||
        plainStr(changes.find((c) => /TerminalNotes$/.test(str(c.field)))?.to);
      if (notes) parts.push(notes);
      const remarks = changes.find((c) => isRemarks(str(c.field)));
      if (remarks) {
        const text = plainStr(remarks.to);
        parts.push(text ? `Remarks: ${text}` : 'remarks cleared');
      }
      const rest = changes.filter((c) => {
        const f = str(c.field);
        return !isStatus(f) && !isRemarks(f) && !isTerminal(f);
      });
      const restText = renderChangeList(rest);
      if (restText) parts.push(restText);
      return joinParts(parts);
    }

    case 'sis.discount_code.create':
    case 'sis.discount_code.update':
    case 'sis.discount_code.expire': {
      const parts: string[] = [];
      const values = isRecord(ctx.values) ? ctx.values : {};
      const code = str(ctx.discount_code) || str(values.discountCode);
      const prev = str(ctx.previous_discount_code);
      if (code && prev && prev !== code) parts.push(`${prev}${ARROW}${code}`);
      else if (code) parts.push(code);
      if (action === 'sis.discount_code.create') {
        const type = str(ctx.enrolee_type) || str(values.enroleeType);
        if (type) parts.push(type);
        const range = dateRange(
          ctx.start_date ?? values.startDate,
          ctx.end_date ?? values.endDate
        );
        if (range) parts.push(range);
        const details = plainStr(ctx.details ?? values.details);
        if (details) parts.push(details);
        return joinParts(parts);
      }
      const changes = recArray(ctx.changes).filter(
        (c) => !(prev && str(c.field) === 'discountCode')
      );
      const changeText = renderChangeList(changes);
      if (changeText) parts.push(changeText);
      else if (action === 'sis.discount_code.expire') {
        const end = fmtMaybeDate(ctx.end_date);
        if (end) parts.push(`ends ${end}`);
      }
      return joinParts(parts);
    }

    case 'level.alias.create':
    case 'level.alias.remap': {
      const raw = str(ctx.raw_label);
      const to = str(ctx.mapped_to_label);
      if (!raw && !to) return null;
      const parts: string[] = [
        raw && to ? `“${raw}” now means ${to}` : raw ? `“${raw}”` : to,
      ];
      const was = str(ctx.remapped_from_label);
      if (was) parts.push(`was ${was}`);
      else if (str(ctx.remapped_from_level_id))
        parts.push('was mapped to a different level before');
      return joinParts(parts);
    }

    // Academic year ------------------------------------------------------------
    case 'ay.accepting_applications.toggle': {
      const parts: string[] = [];
      const ay = str(ctx.ay_code);
      const after = boolish(ctx.after);
      if (after === true)
        parts.push(`${ay ? `${ay} ` : ''}opened for applications`);
      else if (after === false)
        parts.push(`${ay ? `${ay} ` : ''}closed for applications`);
      else if (ay) parts.push(ay);
      const closed = strArray(
        ctx.auto_closed_previous ?? ctx.autoClosedPrevious
      );
      if (closed.length) parts.push(`closed ${listText(closed)}`);
      const by = str(ctx.auto_closed_by ?? ctx.autoClosedBy);
      if (by) parts.push(`because ${by} was opened`);
      return joinParts(parts);
    }

    case 'ay.copy_teacher_assignments': {
      const parts: string[] = [];
      const source = str(ctx.source_ay);
      const target = str(ctx.target_ay);
      if (source && target) parts.push(`${source}${ARROW}${target}`);
      const copied = numish(ctx.copied);
      if (copied !== null) parts.push(`${copied} copied`);
      const existed = numish(ctx.skipped_already_existed);
      if (existed !== null && existed > 0)
        parts.push(`${existed} already there`);
      const noSection = numish(ctx.skipped_no_section);
      if (noSection !== null && noSection > 0)
        parts.push(`${noSection} skipped (class not in the new year)`);
      const created = recArray(ctx.created_assignments).map((c) => {
        const teacher = str(c.teacher_name);
        const where = [str(c.class_label), str(c.subject_code)]
          .filter(Boolean)
          .join(' ');
        return teacher && where ? `${teacher}: ${where}` : teacher || where;
      });
      if (created.length) parts.push(listText(created));
      return joinParts(parts);
    }

    case 'section.realphabetize': {
      const n = numish(ctx.rows_renumbered);
      if (n !== null) return `${n} student${n === 1 ? '' : 's'} renumbered`;
      return null;
    }

    case 'section.index.generate': {
      const parts: string[] = [];
      const section = str(ctx.sectionName ?? ctx.section_name ?? ctx.section);
      if (section) parts.push(section);
      const n = numish(ctx.rows_renumbered);
      if (n !== null) parts.push(`${n} student${n === 1 ? '' : 's'} indexed`);
      return joinParts(parts);
    }

    case 'section.index.swap': {
      // Reads as: "P5 Perseverance · Cruz, Ana #3 → #4 · Dizon, Ben #4 → #3".
      // Both sides are spelled out rather than summarised as "2 students
      // swapped" — the whole point of logging a manual correction is that
      // someone can later see WHICH numbers moved without opening the diff.
      const parts: string[] = [];
      const section = str(ctx.sectionName ?? ctx.section_name ?? ctx.section);
      if (section) parts.push(section);

      const side = (v: unknown): string | null => {
        if (!v || typeof v !== 'object') return null;
        const o = v as Record<string, unknown>;
        const name = str(o.name);
        const from = numish(o.old_index);
        const to = numish(o.new_index);
        if (!name) return null;
        if (from === null || to === null) return name;
        return `${name} #${from}${ARROW}#${to}`;
      };

      for (const v of [side(ctx.a), side(ctx.b)]) if (v) parts.push(v);
      return joinParts(parts);
    }

    // Sections -----------------------------------------------------------------
    case 'section.create': {
      const parts: string[] = [];
      // `name` is the key older rows used for the new class's name.
      const section =
        str(ctx.section_name) || str(ctx.sectionName) || str(ctx.name);
      const level = str(ctx.level_label);
      if (section) parts.push(level ? `${section} (${level})` : section);
      else if (level) parts.push(level);
      const track = str(ctx.class_type);
      if (track) parts.push(`${track} track`);
      const subjects = numish(ctx.track_bundle_inserted);
      if (subjects !== null && subjects > 0)
        parts.push(`${plural(subjects, 'subject')} attached`);
      const sheets = numish(ctx.grading_sheets_created);
      if (sheets !== null && sheets > 0)
        parts.push(`${plural(sheets, 'grading sheet')} created`);
      if (str(ctx.track_bundle_error))
        parts.push("the track's subjects could not be attached");
      if (str(ctx.grading_sheets_error))
        parts.push('the grading sheets could not be created');
      return joinParts(parts);
    }

    case 'section.rename': {
      const parts: string[] = [];
      const prev = str(ctx.previous_section_name) || str(ctx.from);
      const next = str(ctx.section_name) || str(ctx.to);
      if (prev && next) parts.push(`${prev}${ARROW}${next}`);
      else if (next) parts.push(next);
      const level = str(ctx.level_label);
      if (level) parts.push(level);
      return joinParts(parts);
    }

    case 'section.delete': {
      const parts: string[] = [];
      const section = str(ctx.section_name) || str(ctx.sectionName);
      const level = str(ctx.level_label);
      if (section) parts.push(level ? `${section} (${level})` : section);
      const sheets = numish(ctx.grading_sheets_deleted);
      if (sheets !== null && sheets > 0)
        parts.push(`${plural(sheets, 'grading sheet')} deleted`);
      const removed = recArray(ctx.removed_teacher_assignments).map((r) => {
        const teacher = str(r.teacher_name) || 'a teacher';
        const role =
          (ASSIGNMENT_ROLE_LABELS as Record<string, string>)[str(r.role)] ?? '';
        const what = str(r.subject_code) || role;
        return what ? `${teacher} (${what})` : teacher;
      });
      if (removed.length)
        parts.push(
          `${plural(removed.length, 'teacher assignment')} removed: ${listText(removed)}`
        );
      return joinParts(parts);
    }

    case 'section.subjects.attach_many':
    case 'section.subjects.load_defaults': {
      const parts: string[] = [];
      const section = str(ctx.section_name) || str(ctx.sectionName);
      if (section) parts.push(section);
      const codes = strArray(ctx.subjectCodes);
      const inserted = numish(ctx.inserted);
      if (codes.length)
        parts.push(
          `${plural(codes.length, 'subject')} attached: ${listText(codes, LIST_CAP)}`
        );
      else if (inserted !== null)
        parts.push(`${plural(inserted, 'subject')} attached`);
      const sheets = numish(ctx.sheetsInserted);
      if (sheets !== null && sheets > 0)
        parts.push(`${plural(sheets, 'grading sheet')} created`);
      const offered = strArray(ctx.level_offerings_created);
      if (offered.length)
        parts.push(
          `now offered to every class in ${str(ctx.level_label) || 'the level'}: ${listText(offered, LIST_CAP)}`
        );
      if (str(ctx.grading_sheets_error))
        parts.push('the grading sheets could not be created');
      return joinParts(parts);
    }

    case 'section.track.assign': {
      const parts: string[] = [];
      const section = str(ctx.section_name) || str(ctx.sectionName);
      if (section) parts.push(section);
      const track = str(ctx.classType);
      const prev = str(ctx.previousClassType);
      if (track) parts.push(diffText('Track', prev, track));
      const inserted = numish(ctx.inserted);
      if (inserted !== null && inserted > 0)
        parts.push(`${plural(inserted, 'subject')} attached`);
      const sheets = numish(ctx.sheetsInserted);
      if (sheets !== null && sheets > 0)
        parts.push(`${plural(sheets, 'grading sheet')} created`);
      const missing = strArray(ctx.missingCodes);
      if (missing.length) parts.push(`not found: ${listText(missing)}`);
      if (str(ctx.grading_sheets_error))
        parts.push('the grading sheets could not be created');
      return joinParts(parts);
    }

    // Evaluation write-ups ---------------------------------------------------
    case 'evaluation.writeup.save':
    case 'evaluation.writeup.submit':
    case 'evaluation.writeup.resubmit': {
      const parts: string[] = [];
      const submitted = boolish(ctx.submitted);
      if (boolish(ctx.un_submitted) === true) parts.push('Returned to draft');
      else if (submitted === true) parts.push('Submitted');
      else if (submitted === false) parts.push('Draft');
      // Characters of writing, not of markup (migration 167).
      const len = numish(ctx.length ?? ctx.content_length);
      if (len !== null) parts.push(`${len} character${len === 1 ? '' : 's'}`);
      return joinParts(parts);
    }

    // Classroom ----------------------------------------------------------------
    case 'classroom.note.save': {
      const len = numish(ctx.length);
      return len !== null ? `${len} character${len === 1 ? '' : 's'}` : null;
    }

    // ⚠ NEVER THE NARRATIVE. `details` and `remarks` are not in the context at
    // all (migration 120); only that they changed, which is all this says.
    case 'discipline.record.file': {
      const parts: string[] = [];
      const type = disciplineTypeText(ctx.record_type_label, ctx.record_type);
      if (type) parts.push(type);
      const on = fmtMaybeDate(ctx.occurred_on);
      if (on) parts.push(on);
      const nature = plainStr(ctx.nature);
      if (nature) parts.push(nature);
      const office = str(ctx.filed_by_office);
      if (office) parts.push(`filed by ${office}`);
      const ack = fmtMaybeDate(ctx.acknowledged_on);
      if (ack) parts.push(`acknowledged ${ack}`);
      if (boolish(ctx.document_url_present) === true)
        parts.push('document link attached');
      return joinParts(parts);
    }

    case 'discipline.record.update': {
      const parts: string[] = [];
      const b = isRecord(ctx.before) ? ctx.before : {};
      const a = isRecord(ctx.after) ? ctx.after : {};
      const bType = disciplineTypeText(b.record_type_label, b.record_type);
      const aType = disciplineTypeText(a.record_type_label, a.record_type);
      if (aType) parts.push(diffText('', bType, aType));
      const on = diffText(
        'Date',
        fmtMaybeDate(b.occurred_on),
        fmtMaybeDate(a.occurred_on)
      );
      if (on && fmtMaybeDate(b.occurred_on) !== fmtMaybeDate(a.occurred_on))
        parts.push(on);
      const bNature = plainStr(b.nature);
      const aNature = plainStr(a.nature);
      if (aNature && bNature !== aNature)
        parts.push(diffText('Nature', bNature, aNature));
      const bAck = fmtMaybeDate(b.acknowledged_on);
      const aAck = fmtMaybeDate(a.acknowledged_on);
      if (bAck !== aAck) {
        const ack = diffText('Acknowledged', bAck, aAck);
        if (ack) parts.push(ack);
      }
      const changed = strArray(ctx.changed_fields).map(
        (f) => DISCIPLINE_FIELD_LABELS[f] ?? humanizeKey(f).toLowerCase()
      );
      if (changed.length)
        parts.push(`changed: ${listText(changed, LIST_CAP + 2)}`);
      else if (Array.isArray(ctx.changed_fields)) parts.push('nothing changed');
      if (boolish(ctx.edited_by_filer) === false)
        parts.push('edited by someone other than the person who filed it');
      return joinParts(parts);
    }

    // Users ------------------------------------------------------------------
    case 'user.create':
    case 'user.delete': {
      const parts: string[] = [];
      const person = personText(ctx);
      if (person) parts.push(person);
      const roles = strArray(ctx.roles);
      const roleText = roles.length
        ? rolesText(roles)
        : rolesText(splitRoles(ctx.role));
      if (roleText) parts.push(roleText);
      if (action === 'user.delete') {
        const stages = recArray(ctx.named_stages).map((s) => {
          const label = str(s.stage_label);
          const flow = str(s.flow_label);
          return label && flow ? `${label} (${flow})` : label || flow;
        });
        if (stages.length)
          parts.push(
            `was on ${plural(stages.length, 'approval step')}: ${listText(stages, 2)}`
          );
        const pooled = recArray(ctx.approver_assignments);
        if (pooled.length) parts.push('was a change-request approver');
      }
      return joinParts(parts);
    }
    case 'role.permissions.update': {
      // "Academic Coordinator · +2 allowed · −1 removed". Names the role and the
      // size of the change; the capability strings themselves are developer
      // vocabulary and would read as noise in a log a school admin scans.
      const role = str(ctx.role);
      const added = Array.isArray(ctx.added) ? ctx.added.length : 0;
      const removed = Array.isArray(ctx.removed) ? ctx.removed.length : 0;
      const notAdded = Array.isArray(ctx.not_added) ? ctx.not_added.length : 0;
      const parts: string[] = [];
      if (role) parts.push(auditRoleLabel(role));
      if (added > 0) parts.push(`+${added} allowed`);
      if (removed > 0) parts.push(`−${removed} removed`);
      if (notAdded > 0) parts.push(`${notAdded} could not be added`);
      return joinParts(parts);
    }
    case 'user.role.update': {
      const parts: string[] = [];
      const person = personText(ctx);
      if (person) parts.push(person);
      if (Array.isArray(ctx.new_roles)) {
        const prev = rolesText(strArray(ctx.previous_roles));
        const next = rolesText(strArray(ctx.new_roles)) || 'no role';
        parts.push(diffText('Roles', prev, next));
      } else {
        const before = isRecord(ctx.before) ? str(ctx.before.role) : '';
        const after = isRecord(ctx.after) ? str(ctx.after.role) : '';
        const from = str(ctx.old_role ?? ctx.from) || before;
        const to = str(ctx.new_role ?? ctx.role ?? ctx.to) || after;
        if (from && to && from !== to)
          parts.push(
            `${rolesText(splitRoles(from))}${ARROW}${rolesText(splitRoles(to))}`
          );
        else if (to) parts.push(rolesText(splitRoles(to)));
      }
      const active = str(ctx.active_role);
      if (active) {
        const prevActive = str(ctx.previous_active_role);
        parts.push(
          diffText(
            'Role in use',
            prevActive ? auditRoleLabel(prevActive) : '',
            auditRoleLabel(active)
          )
        );
      }
      return joinParts(parts);
    }
    case 'user.info.update': {
      const parts: string[] = [];
      const email = str(ctx.email);
      const b = isRecord(ctx.before) ? ctx.before : {};
      const a = isRecord(ctx.after) ? ctx.after : {};
      const hasName = 'new_display_name' in ctx || 'displayName' in a;
      const prevName = str(ctx.previous_display_name) || str(b.displayName);
      const newName = str(ctx.new_display_name) || str(a.displayName);
      const prevEmail = str(ctx.previous_email);
      const newEmail = str(ctx.new_email);
      // Who: the account as it was before this edit.
      if (!newEmail && email)
        parts.push(prevName ? `${prevName} (${email})` : email);
      if (hasName && prevName !== newName)
        parts.push(diffText('Name', prevName, newName) || 'name cleared');
      if (newEmail) parts.push(diffText('Email', prevEmail || email, newEmail));
      else if (boolish(ctx.emailChanged) === true) parts.push('email changed');
      if (boolish(ctx.passwordReset) === true) parts.push('password reset');
      return joinParts(parts);
    }
    case 'user.disable':
    case 'user.enable': {
      const parts: string[] = [];
      const person = personText(ctx);
      if (person) parts.push(person);
      const role = rolesText(splitRoles(ctx.role));
      if (role) parts.push(role);
      return joinParts(parts);
    }
    // Somebody with two roles switched which one is in force. That changes
    // what every later action is allowed to do, so it reads as the role change
    // it is: "School Admin → Teacher". `from_role` / `to_role` are the current
    // keys; `from_view` / `to_view` are what rows before 2026-09-17 carry, and
    // mean the same thing.
    case 'user.view.switch': {
      const to = str(ctx.to_role) || str(ctx.to_view);
      if (!to) return null;
      const from = str(ctx.from_role) || str(ctx.from_view);
      // A first switch has nothing to move FROM — say where they landed.
      if (!from || from === to) return `Now working as ${auditRoleLabel(to)}`;
      return `${auditRoleLabel(from)}${ARROW}${auditRoleLabel(to)}`;
    }
    case 'user.password.change':
      return boolish(ctx.self_service) === true
        ? 'Changed their own password on the Account page'
        : 'Password changed';

    // Grading sheets ---------------------------------------------------------
    case 'sheet.create':
    case 'sheet.bulk_create':
    case 'sheet.lock':
    case 'sheet.unlock':
    case 'sheet.unlock_force_with_pending_crs':
    case 'sheet.unlock_force_deadline_passed': {
      const parts: string[] = [];
      const subject = str(ctx.subject_name ?? ctx.subject_code ?? ctx.subject);
      if (subject) parts.push(subject);
      const section = str(ctx.section_name ?? ctx.section);
      const level = str(ctx.level_label);
      if (section)
        parts.push(
          level && !section.includes(level) ? `${section} (${level})` : section
        );
      const term = str(
        ctx.term_label ?? ctx.term ?? termLabel(ctx.term_number)
      );
      if (term) parts.push(term);
      const count = numish(
        ctx.count ?? ctx.created ?? ctx.sheets_created ?? ctx.inserted
      );
      if (count !== null) parts.push(`${count} sheet${count === 1 ? '' : 's'}`);
      const subjects = strArray(ctx.subject_names);
      const sections = strArray(ctx.section_names);
      const terms = strArray(ctx.term_labels);
      if (subjects.length) parts.push(listText(subjects));
      if (sections.length) parts.push(listText(sections));
      if (terms.length) parts.push(listText(terms, LIST_CAP));
      const teacher = str(ctx.teacher_name);
      if (teacher) parts.push(teacher);
      const seeded = numish(ctx.entries_seeded);
      if (action === 'sheet.create' && seeded !== null)
        parts.push(`${plural(seeded, 'student')} added`);
      if (str(ctx.via) === 'bulk')
        parts.push('locked together with other sheets');
      if (action.startsWith('sheet.unlock')) {
        const by = str(ctx.previously_locked_by);
        const at = fmtMaybeDate(ctx.previously_locked_at);
        if (by === 'system:grading-deadline')
          parts.push(
            at
              ? `had been locked automatically at the deadline (${at})`
              : 'had been locked automatically at the deadline'
          );
        else if (at) parts.push(`had been locked on ${at}`);
        const pending = numish(ctx.pendingCount);
        if (pending !== null && pending > 0)
          parts.push(`${plural(pending, 'change request')} still waiting`);
        const deadline = fmtMaybeDate(ctx.lockDate);
        if (deadline) parts.push(`grading deadline was ${deadline}`);
      }
      return joinParts(parts);
    }

    case 'sheet.lock_overdue_batch': {
      const parts: string[] = [];
      const sheets = recArray(ctx.sheets);
      const count = numish(ctx.locked_count) ?? (sheets.length || null);
      if (count !== null) parts.push(`${plural(count, 'sheet')} locked`);
      const names = sheets.map((s) =>
        [str(s.section_name), str(s.subject_name), str(s.term_label)]
          .filter(Boolean)
          .join(' ')
      );
      if (names.filter(Boolean).length) parts.push(listText(names));
      const notLocked = numish(ctx.not_locked_count);
      if (notLocked !== null && notLocked > 0)
        parts.push(`${plural(notLocked, 'sheet')} still unlocked`);
      return joinParts(parts);
    }

    case 'sheet.labels.update': {
      const changes = recArray(ctx.changes);
      if (!changes.length) return null;
      const rendered = changes.map((c) => {
        const slot = slotName(str(c.slot));
        const o = slotLabelText(c.old);
        const n = slotLabelText(c.new);
        if (o === n) return `${slot}: date or page changed`;
        return diffText(slot, o ? `“${o}”` : '', n ? `“${n}”` : '') || slot;
      });
      const shown = rendered.slice(0, LIST_CAP).join(SEP);
      return rendered.length > LIST_CAP
        ? `${shown}${SEP}+${rendered.length - LIST_CAP} more`
        : shown;
    }

    case 'subject_config.term_weights': {
      const parts: string[] = [];
      const after = weightsText(ctx.after);
      if (after) parts.push(`Weights now: ${after}`);
      const before = recArray(ctx.before)
        .map((b) => {
          const name = str(b.section);
          const w = shortWeights(b);
          return name && w ? `${name} ${w}` : name;
        })
        .filter(Boolean);
      if (before.length) parts.push(`was: ${listText(before)}`);
      const updated = numish(ctx.sheets_updated);
      if (updated !== null)
        parts.push(`${plural(updated, 'class', 'classes')} updated`);
      const locked = strArray(ctx.locked_classes_skipped);
      if (locked.length) parts.push(`locked, left alone: ${listText(locked)}`);
      const notRecomputed = strArray(ctx.classes_not_recomputed);
      if (notRecomputed.length)
        parts.push(`grades not recalculated for: ${listText(notRecomputed)}`);
      return joinParts(parts);
    }

    case 'subject_report_map.update': {
      const parts: string[] = [];
      const subject = str(ctx.subject_code);
      const report = str(ctx.report_subject_code);
      if (subject && report)
        parts.push(`${subject} now reports under ${report}`);
      else if (report) parts.push(`reports under ${report}`);
      const previous = recArray(ctx.previous)
        .map((p) => str(p.report_subject_code))
        .filter(Boolean);
      if (Array.isArray(ctx.previous))
        parts.push(
          previous.length
            ? `was ${listText(previous)}`
            : 'was not mapped before'
        );
      if (boolish(ctx.mapping_removed_without_replacement) === true)
        parts.push('the old mapping was removed but the new one was not saved');
      return joinParts(parts);
    }

    case 'grade_entry.annual_letter.update': {
      const parts: string[] = [];
      const before = str(ctx.before);
      const after = str(ctx.after);
      const diff = diffText('Final grade', before, after);
      if (diff) parts.push(diff);
      const note = plainStr(ctx.correction_note);
      if (note) parts.push(note);
      if (boolish(ctx.was_locked) === true) parts.push('sheet was locked');
      return joinParts(parts);
    }

    // Term config ------------------------------------------------------------
    case 'ay.term_dates.update': {
      const parts: string[] = [];
      const term = termOf(ctx);
      if (term) parts.push(term);
      const b = isRecord(ctx.before) ? ctx.before : {};
      const a = isRecord(ctx.after) ? ctx.after : {};
      const newRange = dateRange(
        ctx.new_start_date ?? a.start_date ?? ctx.start_date ?? ctx.new_start,
        ctx.new_end_date ?? a.end_date ?? ctx.end_date ?? ctx.new_end
      );
      const oldRange = dateRange(
        ctx.old_start_date ?? b.start_date,
        ctx.old_end_date ?? b.end_date
      );
      const range = diffText('', oldRange, newRange);
      if (range) parts.push(range);
      const sync = isRecord(ctx.calendar_sync) ? ctx.calendar_sync : null;
      if (sync) {
        const added = numish(sync.inserted);
        const removed = numish(sync.deleted);
        const bits = [
          added ? `${plural(added, 'school day')} added` : '',
          removed ? `${plural(removed, 'school day')} removed` : '',
        ].filter(Boolean);
        if (bits.length) parts.push(bits.join(', '));
      }
      return joinParts(parts);
    }
    case 'ay.term_virtue.update': {
      const parts: string[] = [];
      const term = termOf(ctx);
      if (term) parts.push(term);
      const b = isRecord(ctx.before) ? ctx.before : {};
      const a = isRecord(ctx.after) ? ctx.after : {};
      const o = str(
        ctx.old_virtue_theme ?? b.virtue_theme ?? ctx.old_virtue ?? ctx.old
      );
      const n = str(
        ctx.new_virtue_theme ??
          a.virtue_theme ??
          ctx.new_virtue ??
          ctx.new ??
          ctx.virtue_theme
      );
      const diff = diffText('Virtue', o, n);
      if (diff) parts.push(diff);
      return joinParts(parts);
    }
    case 'ay.term_grading_lock.update': {
      const parts: string[] = [];
      const term = termOf(ctx);
      if (term) parts.push(term);
      const b = isRecord(ctx.before) ? ctx.before : {};
      const a = isRecord(ctx.after) ? ctx.after : {};
      const diff = diffText(
        'Grading lock date',
        fmtMaybeDate(ctx.old_grading_lock_date ?? b.grading_lock_date),
        fmtMaybeDate(ctx.new_grading_lock_date ?? a.grading_lock_date)
      );
      if (diff) parts.push(diff);
      return joinParts(parts);
    }

    // Grade levels (Levels & Grade Progression, migration 078) — dormant
    // since migration 086 removed the admin page; historical rows only.
    case 'level.create':
    case 'level.delete': {
      const parts: string[] = [];
      const code = str(ctx.code);
      const label = str(ctx.label);
      if (code && label) parts.push(`${code} · ${label}`);
      else if (label) parts.push(label);
      else if (code) parts.push(code);
      const levelType = str(ctx.levelType ?? ctx.level_type);
      if (levelType) parts.push(humanizeKey(levelType));
      return joinParts(parts);
    }
    case 'level.update': {
      const parts: string[] = [];
      const code = str(ctx.code);
      const label = str(ctx.label);
      if (code) parts.push(code);
      else if (label) parts.push(label);
      const before = isRecord(ctx.before) ? ctx.before : null;
      const after = isRecord(ctx.after) ? ctx.after : null;
      if (before && after) {
        const labelDiff = scalarDiff(before.label, after.label, 'label');
        if (labelDiff) parts.push(labelDiff);
        const sortDiff = scalarDiff(
          before.sort_order,
          after.sort_order,
          'sort order'
        );
        if (sortDiff) parts.push(sortDiff);
        if (!valuesEqual(before.next_level_id, after.next_level_id)) {
          parts.push('progression updated');
        }
      }
      return joinParts(parts);
    }
    case 'level.offering.toggle': {
      const parts: string[] = [];
      const code = str(ctx.code);
      const label = str(ctx.label);
      if (code && label) parts.push(`${code} · ${label}`);
      else if (label) parts.push(label);
      else if (code) parts.push(code);
      const offered = boolish(ctx.offered);
      if (offered === true) parts.push('offered');
      else if (offered === false) parts.push('not offered');
      return joinParts(parts);
    }

    case 'school_config.update': {
      if (Array.isArray(ctx.changes))
        return renderChangeList(ctx.changes) || null;
      // Rows before 2026-09-17 carry only `diff: { column: { before, after } }`.
      if (isRecord(ctx.diff)) {
        const changes = Object.entries(ctx.diff).map(([column, d]) => ({
          field: column,
          column,
          from: isRecord(d) ? d.before : null,
          to: isRecord(d) ? d.after : null,
        }));
        return renderChangeList(changes) || null;
      }
      return null;
    }

    // Teacher assignments. Handled explicitly rather than left to the generic
    // fallback for three reasons: the fallback caps at LIST_CAP rendered keys
    // (the reason could be truncated away), it would print `role` as the raw
    // database word `subject_teacher`, and `role` can't be added to the shared
    // `enumKeys` set because staff-account entries use the same key for USER
    // roles. Reads e.g.
    //   "Ms Tan · Subject teacher, Mathematics, P4 Diligence · On leave"
    case 'assignment.create':
    case 'assignment.delete': {
      const parts: string[] = [];
      const teacher = str(ctx.teacher_name);
      if (teacher) parts.push(teacher);

      // Role, then what they were teaching, then where.
      const roleLabel =
        (ASSIGNMENT_ROLE_LABELS as Record<string, string>)[str(ctx.role)] ?? '';
      const where = [roleLabel, str(ctx.subject_name), str(ctx.section_name)]
        .filter(Boolean)
        .join(', ');
      if (where) parts.push(where);

      const reason = labelFor('change_reason', ctx.change_reason);
      if (reason) parts.push(reason);
      // Rich text — the "Notes" box on the assignment-removal dialog.
      const notes = plainStr(ctx.change_notes);
      if (notes) parts.push(notes);

      return joinParts(parts);
    }

    // Cover for an absent teacher. Deliberately names BOTH people — the whole
    // point of the entry is who stood in for whom, and a line reading only
    // "Ms Radhika · P5 Tenacity, Mathematics" would be indistinguishable from
    // an ordinary assignment. Reads e.g.
    //   "Ms Radhika covering Ms Koh · Subject teacher, Mathematics, P5 Tenacity"
    //
    // Since migration 117 these two entries are the ONLY record of a finished
    // cover — clearing the column leaves nothing behind on the assignment. So
    // this pair has to read as a complete account on its own.
    case 'assignment.relief.start':
    case 'assignment.relief.end': {
      const parts: string[] = [];

      const relief = str(ctx.relief_teacher_name);
      const covered = str(ctx.covered_teacher_name);
      const previous = str(ctx.previous_relief_teacher_name);
      // On an `.end` entry there is no substitute name — the column was
      // cleared, and the context records the null. The substitute who WAS
      // covering is in `previous_relief_teacher_name` on rows since
      // 2026-09-17; older rows name them only on the `.start` entry.
      if (relief && covered) parts.push(`${relief} covering ${covered}`);
      else if (relief) parts.push(relief);
      else if (covered)
        parts.push(
          previous
            ? `Cover for ${covered} by ${previous}`
            : `Cover for ${covered}`
        );
      else if (previous) parts.push(`Cover by ${previous}`);

      const roleLabel =
        (ASSIGNMENT_ROLE_LABELS as Record<string, string>)[str(ctx.role)] ?? '';
      const where = [roleLabel, str(ctx.subject_name), str(ctx.section_name)]
        .filter(Boolean)
        .join(', ');
      if (where) parts.push(where);

      // A whole-absence booking: one row for every class the teacher holds.
      const classes = strArray(ctx.class_labels).map((c) =>
        c.includes(' · ') ? c.replace(' · ', ' (') + ')' : c
      );
      const classCount =
        numish(ctx.classes_covered) ?? (classes.length || null);
      if (classes.length)
        parts.push(
          `${plural(classCount ?? classes.length, 'class', 'classes')}: ${listText(classes)}`
        );
      else if (boolish(ctx.bulk) === true && classCount !== null)
        parts.push(plural(classCount, 'class', 'classes'));

      const range = coverRange(ctx.relief_started_on, ctx.relief_ended_on);
      if (range) parts.push(range);

      // Why it was booked (migration 164). Absent on `.end` entries and on
      // covers booked before reasons were asked for.
      const reason = str(ctx.relief_reason);
      if (reason) parts.push(reason);

      // What this booking overwrote. Only on a start — on an end, the
      // previous cover IS the one that ended, and is named above.
      if (action === 'assignment.relief.start') {
        if (previous && previous !== relief)
          parts.push(`replacing ${previous}`);
        else if (!previous) {
          const earlier = numish(ctx.classes_previously_covered);
          if (earlier !== null && earlier > 0)
            parts.push(
              `replacing earlier cover on ${plural(earlier, 'class', 'classes')}`
            );
        }
      }

      return joinParts(parts);
    }

    default:
      return null;
  }
}

// ── Generic fallback ────────────────────────────────────────────────────────

/** Keys that describe the plumbing of a write, not the change itself. */
const HIDDEN_KEYS = new Set([
  'module',
  'trigger',
  'via',
  'flow',
  'action',
  'source',
  'error',
  'errors',
  'partial',
  'failed_step',
  'failedStep',
  'committed',
  'grade_audit_log_failed',
  'truncated',
]);

/** Shown last, and only when there is room. */
const LOW_PRIORITY_KEYS = new Set(['ay_code', 'ayCode', 'run_date', 'scope']);

const IMPORTANT_KEY_RE =
  /reason|note|remark|justification|date|_on$|status|count|before|after|from|^to$|old|new|label|title|added|removed|deleted|inserted|created|changed/i;

function keyRank(key: string): number {
  if (LOW_PRIORITY_KEYS.has(key)) return 2;
  if (IMPORTANT_KEY_RE.test(key)) return 0;
  return 1;
}

function genericSummary(
  ctx: Record<string, unknown>,
  scalarsOnly = false
): string {
  // (a) changes[] array of {field, from, to}
  if (!scalarsOnly && Array.isArray(ctx.changes)) {
    const rendered = renderChangeList(ctx.changes);
    if (rendered) return rendered;
  }

  // (b) before / after objects
  if (!scalarsOnly && (isRecord(ctx.before) || isRecord(ctx.after))) {
    const before = isRecord(ctx.before) ? ctx.before : {};
    const after = isRecord(ctx.after) ? ctx.after : {};
    const keys = Array.from(
      new Set([...Object.keys(before), ...Object.keys(after)])
    ).filter(
      (k) => !shouldSkipKey(k, before[k]) && !shouldSkipKey(k, after[k])
    );
    const rendered: string[] = [];
    for (const k of keys) {
      const b = before[k];
      const a = after[k];
      if (valuesEqual(b, a)) continue;
      const bv = renderValue(k, b);
      const av = renderValue(k, a);
      if (bv === '' && av === '') continue;
      rendered.push(`${fieldLabel(k)}: ${bv || EMPTY}${ARROW}${av || EMPTY}`);
      if (rendered.length >= LIST_CAP) break;
    }
    if (rendered.length) {
      const total = keys.filter(
        (k) => !valuesEqual(before[k], after[k])
      ).length;
      const extra = total > LIST_CAP ? `; +${total - LIST_CAP} more` : '';
      return rendered.join('; ') + extra;
    }
  }

  // (c) scalar field + old/new
  if (!scalarsOnly) {
    const field = str(ctx.field);
    if (field) {
      const diff = scalarDiff(ctx.old, ctx.new, field);
      if (diff) return diff;
    }
  }

  // (d) the remaining entries, most meaningful first. Who / which class is
  // the lead's job and is not repeated here.
  const candidates: Array<{ key: string; text: string; rank: number }> = [];
  for (const [k, v] of Object.entries(ctx)) {
    if (shouldSkipKey(k, v)) continue;
    if (IDENTITY_KEYS.has(k) || HIDDEN_KEYS.has(k)) continue;
    let text = '';
    if (Array.isArray(v)) {
      if (scalarsOnly) continue;
      const items = strArray(v);
      if (items.length) text = listText(items);
      else if (v.length && v.every(isRecord)) text = String(v.length);
    } else if (isScalar(v)) {
      if (v === null || v === '') continue;
      text = renderValue(k, v);
    }
    if (text === '') continue;
    candidates.push({
      key: k,
      text: `${fieldLabel(k)}: ${text}`,
      rank: keyRank(k),
    });
  }
  if (candidates.length) {
    const ordered = candidates
      .map((c, i) => ({ ...c, i }))
      .sort((a, b) => a.rank - b.rank || a.i - b.i);
    const shown = ordered.slice(0, LIST_CAP).map((c) => c.text);
    const extra =
      ordered.length > LIST_CAP
        ? `${SEP}+${ordered.length - LIST_CAP} more`
        : '';
    return shown.join(SEP) + extra;
  }

  return EMPTY;
}

/** "First Name: Ann → Anna · School name: A → B · +2 more", or ''. */
function renderChangeList(changes: unknown): string {
  if (!Array.isArray(changes)) return '';
  const rendered = changes
    .map((c) => (isRecord(c) ? renderChange(c) : ''))
    .filter(Boolean);
  if (!rendered.length) return '';
  const shown = rendered.slice(0, LIST_CAP).join(SEP);
  return rendered.length > LIST_CAP
    ? `${shown}${SEP}+${rendered.length - LIST_CAP} more`
    : shown;
}

function renderChange(c: Record<string, unknown>): string {
  const field = str(c.field);
  if (!field) return '';
  const column = str(c.column) || field;
  const label = fieldLabel(field);
  const from = c.from;
  const to = c.to;
  if (Array.isArray(from) || Array.isArray(to)) {
    // Lists of readable lines (residence history since 2026-09-17): say what
    // was added and what was taken away rather than printing both lists.
    const a = strArray(from).map(tidyItem);
    const b = strArray(to).map(tidyItem);
    const added = b.filter((x) => !a.includes(x));
    const removed = a.filter((x) => !b.includes(x));
    const bits: string[] = [];
    if (added.length) bits.push(`added ${listText(added, 2)}`);
    if (removed.length) bits.push(`removed ${listText(removed, 2)}`);
    return bits.length ? `${label}: ${bits.join('; ')}` : `${label} changed`;
  }
  if (isLinkKey(column) || isRecord(from) || isRecord(to))
    return `${label} changed`;
  const o = renderValue(column, from);
  const n = renderValue(column, to);
  return diffText(label, o, n) || `${label} cleared`;
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers — keys, values, enums, dates
// ─────────────────────────────────────────────────────────────────────────

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T/;
/** An HTML tag — what a formatting-editor value looks like. */
const TAG_RE = /<\/?[a-z][a-z0-9]*(?:\s[^<>]*)?\/?>/i;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isScalar(v: unknown): v is string | number | boolean | null {
  return (
    v === null ||
    typeof v === 'string' ||
    typeof v === 'number' ||
    typeof v === 'boolean'
  );
}

function str(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return '';
}

/** Strings (and numbers) in an array; anything else is dropped. */
function strArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => str(x)).filter(Boolean);
}

function recArray(v: unknown): Array<Record<string, unknown>> {
  return Array.isArray(v) ? v.filter(isRecord) : [];
}

/**
 * `str`, for the context keys that hold something a person typed in the
 * formatting editor.
 *
 * ⚠ A SEPARATE HELPER AND NOT A CHANGE TO `str`. Every summary here is ONE
 * LINE, parts joined with ` · `, so a rejection reason or a set of change
 * notes arriving as `<p>…</p><ul><li>…` would put the markup itself on screen.
 * But `str` is called on dozens of keys per row that were never HTML, and
 * parsing all of them would make the audit-log page pay for a parse per field
 * per row. Only keys that genuinely hold editor output use this.
 *
 * The last line of defence is `flattenMarkup` in `auditContextSummary`, which
 * catches markup that reached the line some other way.
 */
function plainStr(v: unknown): string {
  const raw = str(v);
  return raw === '' ? '' : oneLine(toPlainText(raw));
}

function oneLine(text: string): string {
  return text.replace(/\s*\n+\s*/g, ' ').trim();
}

/** Only parses when a tag is actually there. */
function flattenMarkup(text: string): string {
  return TAG_RE.test(text) ? oneLine(toPlainText(text)) : text;
}

function numish(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) {
    return Number(v);
  }
  return null;
}

function boolish(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return null;
}

/** A link or a storage path — never printed; it can carry a sharing token. */
function isLinkKey(key: string): boolean {
  return /(url|Url|URL|_path|Path)$/.test(key) || key === 'logo_url';
}

function shouldSkipKey(key: string, value?: unknown): boolean {
  if (key === 'id') return true;
  if (/_id$/.test(key)) return true;
  if (/Id$/.test(key)) return true;
  if (/_ids$/.test(key) || /Ids$/.test(key)) return true;
  if (isLinkKey(key)) return true;
  if (typeof value === 'string' && UUID_RE.test(value)) return true;
  return false;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (isScalar(a) && isScalar(b)) return String(a) === String(b);
  return false;
}

// Friendly overrides for identifier keys that would otherwise read as raw
// camelCase (or be meaningless to a school admin). Number keys become a short
// "no." label; name keys collapse to a plain "Student".
const FRIENDLY_KEY_LABELS: Record<string, string> = {
  studentNumber: 'Student no.',
  student_number: 'Student no.',
  enroleeNumber: 'Application no.',
  studentName: 'Student',
  student_name: 'Student',
  enroleeFullName: 'Student',
  fullName: 'Student',
};

/** What each stored field is called on the screens that edit it. */
const FIELD_LABELS: Record<string, string> = {
  qa_score: 'Quarterly Assessment',
  qa_total: 'Quarterly Assessment total',
  letter_grade: 'Letter grade',
  is_na: 'Not applicable',
  annual_letter_grade: 'Final grade',
  weights: 'Weights',
  stpApplicationStatus: 'Student Pass application status',
  stpApplicationType: 'Student Pass application type',
  preCourseDate: 'Pre-course session date',
  preCourseAnswer: 'Pre-course answer',
  residenceHistory: 'Residence history',
  bus_no: 'Bus number',
  classroom_officer_role: 'Class officer role',
  academics_notes: 'Academic notes',
  admin_notes: 'Admin notes',
  enrollment_status: 'Status',
  enrollment_date: 'Start date',
  late_enrollee_term_number: 'Joined in term',
  withdrawal_date: 'Last day',
  withdrawal_approved_date: 'Withdrawal approved',
  withdrawal_reason: 'Withdrawal reason',
  withdrawal_notes: 'Withdrawal notes',
  discountCode: 'Code',
  enroleeType: 'Student type',
  startDate: 'Start date',
  endDate: 'End date',
  details: 'Details',
};

/**
 * The field a change is about, in words. Score slots are stored as
 * `ww_scores[2]` — "Written Work 3" to a teacher.
 */
function fieldLabel(field: string, slotIndex?: unknown): string {
  const m = /^(ww|pt)_(scores|totals)(?:\[(\d+)\])?$/.exec(field);
  if (m) {
    const comp = m[1] === 'ww' ? 'Written Work' : 'Performance Task';
    const idx = m[3] !== undefined ? Number(m[3]) : numish(slotIndex);
    const n = idx === null ? '' : ` ${idx + 1}`;
    return m[2] === 'totals' ? `${comp}${n} total` : `${comp}${n}`;
  }
  const known = FIELD_LABELS[field] ?? FRIENDLY_KEY_LABELS[field];
  if (known) return known;
  // Already a label (school settings write "Principal name").
  if (/\s/.test(field) && /^[A-Z]/.test(field)) return field;
  return humanizeKey(field);
}

/** "WW3" → "Written Work 3". */
function slotName(slot: string): string {
  const m = /^(WW|PT)(\d+)$/i.exec(slot);
  if (m)
    return `${m[1].toUpperCase() === 'WW' ? 'Written Work' : 'Performance Task'} ${m[2]}`;
  if (slot.toUpperCase() === 'QA') return 'Quarterly Assessment';
  return slot || 'Activity';
}

function slotLabelText(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (isRecord(v)) return str(v.label);
  return '';
}

// What a role is CALLED — used both for the `user.view.switch` summary and by
// the audit tables for the `actor_role` line under the Who column, so the
// two never disagree. Uses the same map the switcher itself renders
// (`ROLE_LABEL`); `humanizeKey` alone would turn `p_file_officer` into
// "P File Officer". Falls back for a value the map does not know, so a role
// added later still reads as English rather than snake_case.
//
// ⚠ RETIRED ROLES STILL HAVE TO RENDER. `ROLE_LABEL` is keyed on the LIVE
// `Role` union, but this function reads `audit_log.actor_role`, which is
// history — every row a retired role ever wrote still carries its string, and
// those rows are read forever. Retiring a role must therefore move its label
// here, not delete it, or years of log lines start reading "P File Officer"
// (or worse, raw snake_case) on the day the union changes. The parameter is
// `string`, not `Role`, for exactly this reason.
const RETIRED_ROLE_LABELS: Record<string, string> = {
  // Retired 2026-09-10; admissions absorbed the whole document lifecycle.
  p_file_officer: 'P-File Officer',
};

export function auditRoleLabel(role: string): string {
  return (
    ROLE_LABEL[role as Role] ?? RETIRED_ROLE_LABELS[role] ?? humanizeKey(role)
  );
}

/** Role keys ("teacher, school_admin") or labels ("Teacher, School Admin"). */
function splitRoles(v: unknown): string[] {
  return str(v)
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);
}

function rolesText(roles: readonly string[]): string {
  return roles
    .map((r) => (/[A-Z ]/.test(r) ? r : auditRoleLabel(r)))
    .join(', ');
}

/** "Ms Lhen (lhen@hfse.edu.sg)", or whichever half the row has. */
function personText(ctx: Record<string, unknown>): string {
  const name = str(ctx.display_name);
  const email = str(ctx.email);
  if (name && email && name !== email) return `${name} (${email})`;
  return name || email;
}

function flowLabel(ctx: Record<string, unknown>): string {
  const label = str(ctx.flow_label);
  if (label) return label;
  const flow = str(ctx.flow);
  if (!flow) return '';
  return (
    (STAGED_FLOW_LABELS as Record<string, string>)[flow] ??
    (APPROVER_FLOW_LABELS as Record<string, string>)[flow] ??
    ''
  );
}

function ruleLabel(v: unknown): string {
  const raw = str(v);
  if (!raw) return '';
  return (
    (APPROVAL_RULE_LABELS as Record<string, string>)[raw] ?? humanizeKey(raw)
  );
}

function disciplineTypeText(label: unknown, type: unknown): string {
  return (
    str(label) ||
    (DISCIPLINE_RECORD_TYPE_LABELS as Record<string, string>)[str(type)] ||
    (str(type) ? humanizeKey(str(type)) : '')
  );
}

const DISCIPLINE_FIELD_LABELS: Record<string, string> = {
  record_type: 'type',
  occurred_on: 'date',
  occurred_at_time: 'time',
  nature: 'nature',
  acknowledged_on: 'acknowledged date',
  filed_by_office: 'office',
  document_url: 'document link',
  details: 'details',
  remarks: 'remarks',
};

const REMINDER_SKIP_LABELS: Record<string, string> = {
  cooldown: 'reminded recently',
  not_enrolled: 'not enrolled',
  no_recipients: 'no parent email on file',
  no_actionable_status: 'nothing to chase',
  send_failed: 'email failed',
  unknown_slot: 'unknown document',
  no_application_row: 'no application found',
  no_status_row: 'no application found',
};

// One student synced from an admissions stage (`change` on the row).
const SYNC_ONE_LABELS: Record<string, string> = {
  enrolled: 'Added to their class list',
  inserted: 'Added to the student records and their class list',
  reactivated: 'Back on their class list',
  updated: 'Student details updated',
  unchanged: 'Nothing to change',
  skipped: 'Not synced',
};

const SYNC_ONE_OUTCOME_LABELS: Record<string, string> = {
  enrolled: 'placed in a class',
  inserted: 'added',
  reactivated: 'back on a class list',
  updated: 'updated',
  unchanged: 'unchanged',
  skipped: 'skipped',
};

// The whole-year sync: count key → words, and the change it counts.
const SYNC_BULK_KEYS: ReadonlyArray<readonly [string, string]> = [
  ['added', 'added'],
  ['updated', 'renamed'],
  ['enrolled', 'placed in a class'],
  ['withdrawn', 'withdrawn'],
  ['reactivated', 'back on a class list'],
];
const SYNC_BULK_CHANGE: Record<string, string> = {
  added: 'added',
  updated: 'renamed',
  enrolled: 'enrolled',
  withdrawn: 'withdrawn',
  reactivated: 'reactivated',
};
const SYNC_CHANGE_ORDER: ReadonlyArray<readonly [string, string]> = [
  ['withdrawn', 'Withdrawn'],
  ['reactivated', 'Back'],
  ['enrolled', 'Placed'],
  ['added', 'Added'],
  ['renamed', 'Renamed'],
];

function slotLabelForKey(key: string): string {
  return DOCUMENT_SLOTS.find((s) => s.key === key)?.label ?? humanizeKey(key);
}

/** The document a P-Files / admissions row is about. */
function docLabel(ctx: Record<string, unknown>): string {
  const label = str(ctx.label) || str(ctx.slot_label);
  if (label) return label;
  const key = str(ctx.slot_key) || str(ctx.slotKey) || str(ctx.slot);
  return key ? slotLabelForKey(key) : '';
}

function pushEvidenceKind(parts: string[], v: unknown): void {
  const kind = str(v);
  if (kind === 'file') parts.push('certificate uploaded');
  else if (kind === 'link') parts.push('certificate link');
  else if (kind === 'both') parts.push('certificate uploaded and link');
}

/** "P1, P2" / "whole school" for a calendar event. */
function eventAudienceText(ctx: Record<string, unknown>): string {
  const levels = strArray(ctx.levels);
  if (levels.length) return listText(levels, LIST_CAP);
  const sections = Array.isArray(ctx.sectionIds ?? ctx.section_ids)
    ? ((ctx.sectionIds ?? ctx.section_ids) as unknown[]).length
    : 0;
  if (sections > 0) return plural(sections, 'class', 'classes');
  return labelFor('audience', ctx.audience);
}

/** One day on the school calendar: "3 Mar 2026: School day → Public holiday “Deepavali”". */
function calendarDayChange(rec: Record<string, unknown>): string {
  const date = fmtMaybeDate(rec.date);
  const from = labelFor(
    'day_type',
    rec.before_day_type ?? rec.old_day_type ?? rec.from ?? rec.old
  );
  const to = labelFor(
    'day_type',
    rec.after_day_type ?? rec.new_day_type ?? rec.to ?? rec.new
  );
  const bits: string[] = [];
  if (from && to && from !== to) bits.push(`${from}${ARROW}${to}`);
  else if (to || from) bits.push(to || from);
  const beforeLabel = str(rec.before_label);
  const afterLabel = str(rec.after_label ?? rec.label);
  if (beforeLabel && afterLabel && beforeLabel !== afterLabel)
    bits.push(`“${beforeLabel}”${ARROW}“${afterLabel}”`);
  else if (afterLabel) bits.push(`“${afterLabel}”`);
  const hblBefore = boolish(rec.before_hbl_overlay);
  const hblAfter = boolish(rec.after_hbl_overlay);
  if (hblAfter !== null && hblBefore !== null && hblAfter !== hblBefore)
    bits.push(
      hblAfter ? 'home-based learning added' : 'home-based learning removed'
    );
  const change = bits.join(' ');
  return [date, change].filter(Boolean).join(': ');
}

/** "2 Sep 2026 → 6 Sep 2026", "2 Sep 2026", or ''. */
function dateRange(start: unknown, end: unknown): string {
  const s = fmtMaybeDate(start);
  const e = fmtMaybeDate(end);
  if (s && e) return s === e ? s : `${s} to ${e}`;
  return s ? `from ${s}` : e ? `until ${e}` : '';
}

function coverRange(start: unknown, end: unknown): string {
  const s = fmtMaybeDate(start);
  const e = fmtMaybeDate(end);
  if (s && e) return s === e ? `on ${s}` : `from ${s} to ${e}`;
  if (s) return `from ${s}`;
  if (e) return `until ${e}`;
  return '';
}

/** The term a term-configuration row is about, in the words it recorded. */
function termOf(ctx: Record<string, unknown>): string {
  return (
    str(ctx.term_label) ||
    str(ctx.term) ||
    str(ctx.label) ||
    termLabel(ctx.term_number)
  );
}

/**
 * Written Work / Performance Task / Quarterly Assessment weights, from either
 * whole percentages (`ww`) or the stored fractions (`ww_weight`). Null on all
 * three means the class follows the subject's own weights.
 */
function weightsText(v: unknown): string {
  if (!isRecord(v)) return '';
  if (boolish(v.follows_subject) === true) return 'the same as the subject';
  const keys = ['ww', 'pt', 'qa', 'ww_weight', 'pt_weight', 'qa_weight'];
  if (!keys.some((k) => k in v)) return '';
  const pick = (pctKey: string, fracKey: string): number | null => {
    const p = numish(v[pctKey]);
    if (p !== null) return p;
    const f = numish(v[fracKey]);
    return f === null ? null : Math.round(f * 100);
  };
  const ww = pick('ww', 'ww_weight');
  const pt = pick('pt', 'pt_weight');
  const qa = pick('qa', 'qa_weight');
  if (ww === null && pt === null && qa === null)
    return 'the same as the subject';
  return `Written Work ${ww ?? 0}%, Performance Task ${pt ?? 0}%, Quarterly Assessment ${qa ?? 0}%`;
}

/** "(30% / 50% / 20%)" for one class in a list. */
function shortWeights(v: Record<string, unknown>): string {
  if (boolish(v.follows_subject) === true) return '(same as the subject)';
  const text = weightsText(v);
  if (!text || text === 'the same as the subject')
    return text ? '(same as the subject)' : '';
  const nums = text.match(/\d+%/g) ?? [];
  return `(${nums.join(' / ')})`;
}

function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${n} ${n === 1 ? word : pluralWord}`;
}

/** "Ana, Ben, Cara +2 more" — never silently cut. */
function listText(items: readonly string[], cap = LIST_PREVIEW): string {
  const clean = items.map((s) => s.trim()).filter(Boolean);
  if (!clean.length) return '';
  const shown = clean.slice(0, cap).join(', ');
  return clean.length > cap ? `${shown} +${clean.length - cap} more` : shown;
}

/** "reminded recently ×2, no parent email on file ×1". */
function countBy(items: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  return [...counts.entries()].map(([k, n]) => `${k} ×${n}`).join(', ');
}

/** A readable line recorded with its own ` · ` separators. */
function tidyItem(item: string): string {
  return item.replace(/ · /g, ', ');
}

// Convert snake_case / camelCase identifier → Title Case, honouring the
// friendly-label overrides above.
function humanizeKey(key: string): string {
  const friendly = FRIENDLY_KEY_LABELS[key];
  if (friendly) return friendly;
  const spaced = key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
  if (!spaced) return key;
  return spaced
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

// Prettify an action code (or any dotted/underscored identifier) for display
// when no explicit label exists.
function prettify(action: string): string {
  const flat = action.replace(/\./g, ' ').replace(/[_-]+/g, ' ').trim();
  return humanizeKey(flat);
}

// Route a key to its enum label map; returns '' when not enum-mapped or the
// value isn't a known member.
function labelFor(key: string, value: unknown): string {
  const raw = str(value);
  if (!raw) return '';
  switch (key) {
    case 'status':
    case 'enrollment_status':
    case 'new_status':
    case 'prior_status': {
      if (key === 'enrollment_status') {
        return (ENROLLMENT_STATUS_LABELS as Record<string, string>)[raw] ?? raw;
      }
      if (key === 'status') {
        return (ATTENDANCE_STATUS_LABELS as Record<string, string>)[raw] ?? raw;
      }
      // new_status / prior_status carry either enrollment or attendance values
      // depending on the originating route — try enrollment first, then
      // attendance, then fall back to the raw value.
      return (
        (ENROLLMENT_STATUS_LABELS as Record<string, string>)[raw] ??
        (ATTENDANCE_STATUS_LABELS as Record<string, string>)[raw] ??
        raw
      );
    }
    case 'day_type':
    case 'old_day_type':
    case 'new_day_type':
    case 'before_day_type':
    case 'after_day_type':
      return (DAY_TYPE_LABELS as Record<string, string>)[raw] ?? raw;
    case 'audience':
      return (AUDIENCE_LABELS as Record<string, string>)[raw] ?? raw;
    case 'category':
      return (EVENT_CATEGORY_LABELS as Record<string, string>)[raw] ?? raw;
    case 'ex_reason':
      return (EX_REASON_LABELS as Record<string, string>)[raw] ?? raw;
    case 'reason_category':
      return (REASON_CATEGORY_LABELS as Record<string, string>)[raw] ?? raw;
    case 'correction_reason':
      return (CORRECTION_REASON_LABELS as Record<string, string>)[raw] ?? raw;
    case 'withdrawal_reason':
      return (WITHDRAWAL_REASON_LABELS as Record<string, string>)[raw] ?? raw;
    case 'terminalReason':
    case 'applicationTerminalReason':
      return (
        (APPLICATION_TERMINAL_REASON_LABELS as Record<string, string>)[raw] ??
        raw
      );
    case 'record_type':
      return (
        (DISCIPLINE_RECORD_TYPE_LABELS as Record<string, string>)[raw] ?? raw
      );
    case 'change_reason':
      return (
        (ASSIGNMENT_CHANGE_REASON_LABELS as Record<string, string>)[raw] ?? raw
      );
    default:
      return raw;
  }
}

const ENUM_KEYS = new Set([
  'status',
  'enrollment_status',
  'new_status',
  'prior_status',
  'day_type',
  'old_day_type',
  'new_day_type',
  'before_day_type',
  'after_day_type',
  'audience',
  'category',
  'ex_reason',
  'reason_category',
  'correction_reason',
  'withdrawal_reason',
  'terminalReason',
  'applicationTerminalReason',
  'record_type',
]);

// Render a scalar value, applying enum humanization + date formatting by key.
function renderValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  const raw = str(value);
  if (raw === '') return '';
  if (raw === 'true') return 'Yes';
  if (raw === 'false') return 'No';
  // enum routing
  if (ENUM_KEYS.has(key)) return labelFor(key, value);
  // ⚠ RICH-TEXT ROUTING, AND IT MATTERS MOST HERE. This is the generic tail
  // of `auditContextSummary` — the path taken by every action that has no
  // bespoke case above — so an action nobody wrote a branch for still prints
  // whatever is in its context. Without this the log reads
  // `Rejection Reason: <p>The original script says 18.</p>`. A value that is
  // plainly markup is flattened whatever its key is called.
  if (isRichTextKey(key) || TAG_RE.test(raw)) return oneLine(toPlainText(raw));
  // date routing
  if (ISO_DATETIME_RE.test(raw)) return fmtMaybeDateTime(raw) || raw;
  if (ISO_DATE_RE.test(raw)) return fmtMaybeDate(raw) || raw;
  return raw;
}

/**
 * Context keys whose values come out of the formatting editor.
 *
 * ⚠ KEEP THIS IN STEP WITH THE `RichTextEditor` CALL SITES. Every audit
 * summary is one line; HTML in one is markup on the reader's screen. Adding a
 * formatting editor to a new field means adding its context key here. Any key
 * ending in `Remarks` / `Notes` / `note` is treated the same way, and a value
 * that is plainly markup is flattened regardless (see `renderValue`).
 *
 * `note` IS rich text: the P-Files promise and upload dialogs log the
 * officer's note under that key. The declaration writers are different —
 * they log `note_present` as a boolean and never the words (migration 109's
 * rule), which this set does not change.
 */
const RICH_TEXT_KEYS = new Set([
  'rejection_reason',
  'reason',
  'justification',
  'correction_justification',
  'correction_note',
  'decision_note',
  'change_notes',
  'remarks',
  'nature',
  'details',
  'writeup',
  'ex_note',
  'note',
  'withdrawal_notes',
  'academics_notes',
  'admin_notes',
  'terminalNotes',
  'applicationRemarks',
  'applicationTerminalNotes',
]);

function isRichTextKey(key: string): boolean {
  return RICH_TEXT_KEYS.has(key) || /(Remarks|Notes|_notes|_note)$/.test(key);
}

// "Field: old → new" for a scalar field, applying enum/date humanization.
function scalarDiff(
  oldV: unknown,
  newV: unknown,
  field: string
): string | null {
  const o = renderValue(field, oldV);
  const n = renderValue(field, newV);
  if (o === '' && n === '') return null;
  return diffText(fieldLabel(field), o, n);
}

/** "Label: a → b" from values already rendered; '' when both are empty. */
function diffText(label: string, o: string, n: string): string {
  const prefix = label ? `${label}: ` : '';
  if (o && n) return o === n ? `${prefix}${n}` : `${prefix}${o}${ARROW}${n}`;
  if (n) return `${prefix}${n}`;
  if (o) return `${prefix}${o}${ARROW}blank`;
  return '';
}

function fmtMaybeDate(v: unknown): string {
  const raw = str(v);
  if (!raw) return '';
  if (!ISO_DATE_RE.test(raw) && !ISO_DATETIME_RE.test(raw)) return '';
  const d = new Date(ISO_DATE_RE.test(raw) ? `${raw}T00:00:00Z` : raw);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-SG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function fmtMaybeDateTime(v: unknown): string {
  const raw = str(v);
  if (!raw) return '';
  if (ISO_DATE_RE.test(raw)) return fmtMaybeDate(raw);
  if (!ISO_DATETIME_RE.test(raw)) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-SG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function termLabel(v: unknown): string {
  const n = numish(v);
  if (n === null) return '';
  return `Term ${n}`;
}

function joinParts(parts: string[]): string | null {
  const filtered = parts.map((p) => p.trim()).filter(Boolean);
  if (!filtered.length) return null;
  return filtered.join(SEP);
}
