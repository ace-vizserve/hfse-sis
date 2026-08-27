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

import type { AuditAction } from '@/lib/audit/log-action';
import {
  ATTENDANCE_STATUS_LABELS,
  EX_REASON_LABELS,
  DAY_TYPE_LABELS,
  AUDIENCE_LABELS,
  EVENT_CATEGORY_LABELS,
} from '@/lib/schemas/attendance';
import {
  ENROLLMENT_STATUS_LABELS,
  WITHDRAWAL_REASON_LABELS,
} from '@/lib/schemas/enrolment';
import {
  REASON_CATEGORY_LABELS,
  CORRECTION_REASON_LABELS,
} from '@/lib/schemas/change-request';
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

  // Students / enrolment
  'student.sync': 'Student synced',
  'student.add': 'Student added',
  'student.section.transfer': 'Section transfer',
  'student.withdrawal.cascade': 'Student withdrawn',
  'student.reenrolment.cascade': 'Student re-enrolled',
  'sis.student.assign_section': 'Section assigned',
  'sis.student.auto_sync_batch': 'Students auto-synced',
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

export function auditContextSummary(
  action: string,
  context: Record<string, unknown> | null | undefined
): string {
  if (!context || typeof context !== 'object' || Array.isArray(context))
    return EMPTY;

  const templated = templateSummary(action, context);
  const out = templated ?? genericSummary(context);
  const cleaned = (out ?? '').trim();
  if (!cleaned) return EMPTY;
  // Hard guarantee: never let a brace leak through.
  if (cleaned.includes('{') || cleaned.includes('}')) {
    return genericSummary(context, true) || EMPTY;
  }
  return cleaned;
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
      if (field) {
        const diff = scalarDiff(ctx.old, ctx.new, field);
        parts.push(diff ?? humanizeKey(field));
      }
      const lock = boolish(ctx.was_locked);
      if (lock === true) parts.push('post-lock edit');
      else if (lock === false) parts.push('pre-lock edit');
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
      const field = str(ctx.field);
      if (field) {
        const diff = scalarDiff(
          ctx.proposed_value ?? ctx.old ?? ctx.current_value,
          ctx.proposed ?? ctx.new ?? ctx.proposed_value,
          field
        );
        parts.push(diff ?? humanizeKey(field));
      }
      const cat = labelFor('reason_category', ctx.reason_category);
      if (cat) parts.push(cat);
      const corr = labelFor('correction_reason', ctx.correction_reason);
      if (corr) parts.push(corr);
      const reason = str(ctx.rejection_reason ?? ctx.reason);
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
    case 'declaration.reject': {
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
      const stage = str(ctx.stage_label);
      if (stage) parts.push(stage);
      const outcome = str(ctx.outcome);
      if (outcome === 'advanced') parts.push('moved to the next step');
      else if (outcome === 'completed') parts.push('fully approved');
      if (boolish(ctx.note_present) === true) parts.push('note attached');
      return joinParts(parts);
    }

    // Ordered approval steps -------------------------------------------------
    case 'approval_stage.create':
    case 'approval_stage.update':
    case 'approval_stage.delete':
    case 'approval_stage.approver.assign':
    case 'approval_stage.approver.revoke': {
      const parts: string[] = [];
      const flow = str(ctx.flow_label ?? ctx.flow);
      if (flow) parts.push(flow);
      const stage = str(ctx.stage_label);
      if (stage) parts.push(stage);
      const person = str(ctx.email ?? ctx.display_name);
      if (person) parts.push(person);
      const moved = str(ctx.move);
      if (moved) parts.push(moved === 'up' ? 'moved earlier' : 'moved later');
      const renamed = str(ctx.new_label);
      if (renamed) parts.push(`renamed to ${renamed}`);
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
      if (before && after && before !== after)
        parts.push(`${before}${ARROW}${after}`);
      else if (after) parts.push(after);
      const ex = labelFor('ex_reason', ctx.ex_reason ?? ctx.exReason);
      if (ex) parts.push(ex);
      return joinParts(parts);
    }

    // School calendar upsert -------------------------------------------------
    case 'attendance.calendar.upsert': {
      const parts: string[] = [];
      const audience = labelFor('audience', ctx.audience);
      if (audience) parts.push(audience);
      const diffs = Array.isArray(ctx.diffs) ? ctx.diffs : null;
      if (diffs && diffs.length) {
        const rendered = diffs
          .slice(0, LIST_CAP)
          .map((d) => {
            const rec = isRecord(d) ? d : {};
            const date = fmtMaybeDate(rec.date);
            const from = labelFor(
              'day_type',
              rec.old_day_type ?? rec.from ?? rec.old
            );
            const to = labelFor(
              'day_type',
              rec.new_day_type ?? rec.to ?? rec.new
            );
            const change =
              from && to ? `${from}${ARROW}${to}` : to || from || '';
            return [date, change].filter(Boolean).join(': ');
          })
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

    // Calendar events --------------------------------------------------------
    case 'attendance.event.create':
    case 'attendance.event.update':
    case 'attendance.event.delete': {
      const parts: string[] = [];
      const label = str(ctx.label);
      if (label) parts.push(label);
      const category = labelFor('category', ctx.category);
      if (category) parts.push(category);
      const start = fmtMaybeDate(ctx.start_date ?? ctx.startDate);
      const end = fmtMaybeDate(ctx.end_date ?? ctx.endDate);
      if (start && end && start !== end) parts.push(`${start}${ARROW}${end}`);
      else if (start) parts.push(start);
      return joinParts(parts);
    }

    // Document approve / reject ----------------------------------------------
    case 'sis.document.approve':
    case 'sis.document.reject': {
      const parts: string[] = [];
      const slot = str(ctx.slot_label ?? ctx.slot_key ?? ctx.slot);
      if (slot) parts.push(humanizeKey(slot));
      const status = str(ctx.new_status ?? ctx.status);
      if (status) parts.push(status);
      const reason = str(ctx.rejection_reason ?? ctx.reason);
      if (reason) parts.push(reason);
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
        ctx.window_start ?? ctx.starts_at ?? ctx.from
      );
      const to = fmtMaybeDateTime(ctx.window_end ?? ctx.ends_at ?? ctx.to);
      if (from && to) parts.push(`${from}${ARROW}${to}`);
      else if (from) parts.push(from);
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
      const before = isRecord(ctx.before) ? ctx.before : null;
      const after = isRecord(ctx.after) ? ctx.after : null;
      const fromS = labelFor(
        'enrollment_status',
        (before && before.enrollment_status) ?? ctx.prior_status
      );
      const toS = labelFor(
        'enrollment_status',
        (after && after.enrollment_status) ?? ctx.status
      );
      if (fromS && toS && fromS !== toS) return `${fromS}${ARROW}${toS}`;
      if (toS) return toS;
      // fall through to generic if no status diff present
      return null;
    }

    // Section transfer -------------------------------------------------------
    case 'student.section.transfer': {
      const from = str(ctx.fromSection ?? ctx.from_section ?? ctx.from);
      const to = str(ctx.toSection ?? ctx.to_section ?? ctx.to);
      const term = str(
        ctx.term_label ??
          ctx.termLabel ??
          ctx.term ??
          termLabel(ctx.termNumber ?? ctx.term_number)
      );
      const parts: string[] = [];
      const lead = studentLead(ctx);
      if (lead) parts.push(lead);
      if (from && to) parts.push(`${from}${ARROW}${to}`);
      else if (to) parts.push(to);
      if (term) parts.push(term);
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
      const date = fmtMaybeDate(ctx.withdrawal_date ?? ctx.date);
      if (date) parts.push(date);
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

    // Evaluation write-ups ---------------------------------------------------
    case 'evaluation.writeup.save':
    case 'evaluation.writeup.submit':
    case 'evaluation.writeup.resubmit': {
      const parts: string[] = [];
      const submitted = boolish(ctx.submitted);
      if (boolish(ctx.un_submitted) === true) parts.push('Returned to draft');
      else if (submitted === true) parts.push('Submitted');
      else if (submitted === false) parts.push('Draft');
      const len = numish(ctx.length ?? ctx.content_length);
      if (len !== null) parts.push(`${len} character${len === 1 ? '' : 's'}`);
      return joinParts(parts);
    }

    // Users ------------------------------------------------------------------
    case 'user.create':
    case 'user.delete': {
      const parts: string[] = [];
      const email = str(ctx.email);
      if (email) parts.push(email);
      const role = str(ctx.role);
      if (role) parts.push(humanizeKey(role));
      return joinParts(parts);
    }
    case 'role.permissions.update': {
      // "Academic coordinator · +2 allowed · −1 removed". Names the role and the
      // size of the change; the capability strings themselves are developer
      // vocabulary and would read as noise in a log a school admin scans.
      const role = str(ctx.role);
      const added = Array.isArray(ctx.added) ? ctx.added.length : 0;
      const removed = Array.isArray(ctx.removed) ? ctx.removed.length : 0;
      const parts: string[] = [];
      if (role) parts.push(humanizeKey(role));
      if (added > 0) parts.push(`+${added} allowed`);
      if (removed > 0) parts.push(`−${removed} removed`);
      return joinParts(parts);
    }
    case 'user.role.update': {
      const from = str(ctx.old_role ?? ctx.from);
      const to = str(ctx.new_role ?? ctx.role ?? ctx.to);
      if (from && to) return `${humanizeKey(from)}${ARROW}${humanizeKey(to)}`;
      if (to) return humanizeKey(to);
      return null;
    }

    // Grading sheets ---------------------------------------------------------
    case 'sheet.create':
    case 'sheet.bulk_create':
    case 'sheet.lock':
    case 'sheet.unlock': {
      const parts: string[] = [];
      const subject = str(ctx.subject_name ?? ctx.subject_code ?? ctx.subject);
      if (subject) parts.push(subject);
      const section = str(ctx.section_name ?? ctx.section);
      if (section) parts.push(section);
      const term = str(
        ctx.term_label ?? ctx.term ?? termLabel(ctx.term_number)
      );
      if (term) parts.push(term);
      const count = numish(ctx.count ?? ctx.created ?? ctx.sheets_created);
      if (count !== null) parts.push(`${count} sheet${count === 1 ? '' : 's'}`);
      return joinParts(parts);
    }

    // Term config ------------------------------------------------------------
    case 'ay.term_dates.update': {
      const parts: string[] = [];
      const term = str(
        ctx.term_label ?? ctx.term ?? termLabel(ctx.term_number)
      );
      if (term) parts.push(term);
      const start = fmtMaybeDate(ctx.start_date ?? ctx.new_start);
      const end = fmtMaybeDate(ctx.end_date ?? ctx.new_end);
      if (start && end) parts.push(`${start}${ARROW}${end}`);
      else if (start) parts.push(start);
      return joinParts(parts);
    }
    case 'ay.term_virtue.update': {
      const parts: string[] = [];
      const term = str(
        ctx.term_label ?? ctx.term ?? termLabel(ctx.term_number)
      );
      if (term) parts.push(term);
      const diff = scalarDiff(
        ctx.old_virtue ?? ctx.old,
        ctx.new_virtue ?? ctx.new ?? ctx.virtue_theme,
        'virtue'
      );
      if (diff) parts.push(diff);
      else {
        const v = str(ctx.virtue_theme ?? ctx.new_virtue);
        if (v) parts.push(v);
      }
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
      const notes = str(ctx.change_notes);
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
      // On an `.end` entry there is no substitute name — the column was
      // cleared, and the context records the null. "Cover for Ms Koh ended" is
      // the whole fact; who it was is on the `.start` entry above it.
      if (relief && covered) parts.push(`${relief} covering ${covered}`);
      else if (relief) parts.push(relief);
      else if (covered) parts.push(`Cover for ${covered}`);

      const roleLabel =
        (ASSIGNMENT_ROLE_LABELS as Record<string, string>)[str(ctx.role)] ?? '';
      const where = [roleLabel, str(ctx.subject_name), str(ctx.section_name)]
        .filter(Boolean)
        .join(', ');
      if (where) parts.push(where);

      return joinParts(parts);
    }

    default:
      return null;
  }
}

// ── Generic fallback ────────────────────────────────────────────────────────

function genericSummary(
  ctx: Record<string, unknown>,
  scalarsOnly = false
): string {
  // (a) changes[] array of {field, from, to}
  if (!scalarsOnly && Array.isArray(ctx.changes)) {
    const rendered = ctx.changes
      .slice(0, LIST_CAP)
      .map((c) => {
        if (!isRecord(c)) return '';
        const field = str(c.field);
        if (!field) return '';
        const diff = scalarDiff(c.from, c.to, field);
        return diff ?? humanizeKey(field);
      })
      .filter(Boolean);
    if (rendered.length) {
      const extra =
        (ctx.changes as unknown[]).length > LIST_CAP
          ? `${SEP}+${(ctx.changes as unknown[]).length - LIST_CAP} more`
          : '';
      return rendered.join(SEP) + extra;
    }
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
      rendered.push(`${humanizeKey(k)}: ${bv || EMPTY}${ARROW}${av || EMPTY}`);
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

  // (d) prettify remaining scalar entries
  const hasName = nameFromContext(ctx) !== '';
  const rendered: string[] = [];
  let total = 0;
  for (const [k, v] of Object.entries(ctx)) {
    if (shouldSkipKey(k, v)) continue;
    // When a human name is present, drop the paired raw number key so we don't
    // show "Student: Juan · Student no.: 12345" — the number is internal.
    if (hasName && NUMBER_KEYS_SUPPRESSED_WITH_NAME.includes(k)) continue;
    if (!isScalar(v)) continue;
    if (v === null || v === '') continue;
    const rv = renderValue(k, v);
    if (rv === '') continue;
    total += 1;
    if (rendered.length < LIST_CAP) {
      rendered.push(`${humanizeKey(k)}: ${rv}`);
    }
  }
  if (rendered.length) {
    const extra = total > LIST_CAP ? `${SEP}+${total - LIST_CAP} more` : '';
    return rendered.join(SEP) + extra;
  }

  return EMPTY;
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers — keys, values, enums, dates
// ─────────────────────────────────────────────────────────────────────────

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T/;

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

function shouldSkipKey(key: string, value?: unknown): boolean {
  if (key === 'id') return true;
  if (/_id$/.test(key)) return true;
  if (/Id$/.test(key)) return true;
  if (typeof value === 'string' && UUID_RE.test(value)) return true;
  return false;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (isScalar(a) && isScalar(b)) return String(a) === String(b);
  return false;
}

// Friendly overrides for identifier keys that would otherwise read as raw
// camelCase (or be meaningless to a school admin). Number keys become a short
// "no." label; name keys collapse to a plain "Student".
const FRIENDLY_KEY_LABELS: Record<string, string> = {
  studentNumber: 'Student no.',
  enroleeNumber: 'Application no.',
  studentName: 'Student',
  enroleeFullName: 'Student',
  fullName: 'Student',
  name: 'Student',
};

// Keys that carry a human student/applicant name. When any of these is present
// in a context, we surface the NAME and suppress the paired raw number key.
const NAME_KEYS = [
  'studentName',
  'enroleeFullName',
  'fullName',
  'name',
] as const;

// Raw-number identifier keys that should be suppressed once a name is shown
// (the number is internal — the name reads better for staff).
const NUMBER_KEYS_SUPPRESSED_WITH_NAME = ['studentNumber', 'enroleeNumber'];

// Returns the first non-empty human name in a context, or '' when none.
function nameFromContext(ctx: Record<string, unknown>): string {
  for (const k of NAME_KEYS) {
    const v = str(ctx[k]);
    if (v) return v;
  }
  return '';
}

// Student-centric lead segment for templates: prefer the human name; otherwise
// fall back to a relabeled "Student no. {n}" / "Application no. {n}". Returns ''
// when neither is available (template then leads with its own first part).
function studentLead(ctx: Record<string, unknown>): string {
  const name = nameFromContext(ctx);
  if (name) return name;
  const sn = str(ctx.studentNumber);
  if (sn) return `Student no. ${sn}`;
  const en = str(ctx.enroleeNumber);
  if (en) return `Application no. ${en}`;
  return '';
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
    case 'change_reason':
      return (
        (ASSIGNMENT_CHANGE_REASON_LABELS as Record<string, string>)[raw] ?? raw
      );
    default:
      return raw;
  }
}

// Render a scalar value, applying enum humanization + date formatting by key.
function renderValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  const raw = str(value);
  if (raw === '') return '';
  // enum routing
  const enumKeys = new Set([
    'status',
    'enrollment_status',
    'new_status',
    'prior_status',
    'day_type',
    'old_day_type',
    'new_day_type',
    'audience',
    'category',
    'ex_reason',
    'reason_category',
    'correction_reason',
    'withdrawal_reason',
  ]);
  if (enumKeys.has(key)) return labelFor(key, value);
  // date routing
  if (ISO_DATETIME_RE.test(raw)) return fmtMaybeDateTime(raw) || raw;
  if (ISO_DATE_RE.test(raw)) return fmtMaybeDate(raw) || raw;
  return raw;
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
  if (o !== '' && n !== '' && o !== n) {
    return `${humanizeKey(field)}: ${o}${ARROW}${n}`;
  }
  if (n !== '') return `${humanizeKey(field)}: ${n}`;
  return `${humanizeKey(field)}: ${o}`;
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
