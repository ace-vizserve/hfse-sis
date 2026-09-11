import { z } from 'zod';

import { isEmptyRichText, proseLength } from '@/lib/rich-text';

// Ordered, configurable approval flows — the vocabulary shared by the engine,
// the config screen and the decide route.
//
// ⚠ THIS IS DELIBERATELY NOT `lib/schemas/approvers.ts`.
//
// That file's `APPROVER_FLOWS` describes a different mechanism: a flat POOL of
// approvers where a teacher picks two and whichever acts first becomes
// "primary", ready at ">= 2 approvers". Grade change requests used it until
// they moved onto the two grade-change flows below; the approvers screen, the
// /sis readiness strip and the hub's attention feed now all read readiness
// from `classifyStagedFlowReadiness` (lib/approvals/readiness.ts), whose rule
// is "at least one person on each NAMED step". The pool's own classifier and
// its screen were deleted with that move, rather than left describing a rule
// nothing files against.
//
// Staged flows were kept separate from that tuple from the start, and still
// are: adding one there would have shown "at least 2 approvers" over a flow
// whose rule is different.

export const STAGED_APPROVAL_FLOWS = [
  'attendance.student_declaration',
  'markbook.grade_change',
  'markbook.grade_change_aeb',
] as const;
export type StagedApprovalFlow = (typeof STAGED_APPROVAL_FLOWS)[number];

/**
 * The absence-and-travel flow, named once.
 *
 * ⚠ Lives HERE rather than in `lib/declarations/approval.ts`, which is where
 * it used to be defined, because the sidebar badge and the notification bell
 * are client components: importing it from there would pull the whole
 * materialise/open-a-request module into the browser bundle to read one
 * string. `lib/declarations/approval.ts` re-exports this, so every existing
 * importer keeps working and there is still exactly one definition.
 */
export const DECLARATION_APPROVAL_FLOW: StagedApprovalFlow =
  'attendance.student_declaration';

/**
 * The two grade-change flows (migration 144). The teacher does not choose
 * between them — the system does, when the change is filed: once parents have
 * been able to see the grade on a report card, the change goes to the Academic
 * and Examination Board instead. See `lib/change-requests/approval-route.ts`.
 *
 * Same reason as `DECLARATION_APPROVAL_FLOW` for living here: client
 * components read these to count and label work.
 */
export type GradeChangeApprovalFlow = Extract<
  StagedApprovalFlow,
  'markbook.grade_change' | 'markbook.grade_change_aeb'
>;
export const GRADE_CHANGE_APPROVAL_FLOW: GradeChangeApprovalFlow =
  'markbook.grade_change';
export const GRADE_CHANGE_AEB_APPROVAL_FLOW: GradeChangeApprovalFlow =
  'markbook.grade_change_aeb';

export const STAGED_FLOW_LABELS: Record<StagedApprovalFlow, string> = {
  'attendance.student_declaration':
    'Attendance · Absence and travel declarations',
  'markbook.grade_change':
    'Grade changes — before the report card is published',
  'markbook.grade_change_aeb':
    'Grade changes — after the report card is published (Academic and Examination Board)',
};

export const STAGED_FLOW_DESCRIPTIONS: Record<StagedApprovalFlow, string> = {
  'attendance.student_declaration':
    'When a parent files an absence or a travel declaration, these people approve it in this order. Each step needs one of its people to approve, unless it is set to need all of them. If anyone turns it down, it stops there and the parent is told.',
  'markbook.grade_change':
    'When a teacher asks to change a grade on a locked sheet, and parents have not yet seen that grade on a report card, these people approve it in this order. Each step needs one of its people to approve, unless it is set to need all of them. If anyone turns it down, the grade stays as it is and the teacher is told.',
  'markbook.grade_change_aeb':
    'When a teacher asks to change a grade that parents have already been able to see on a report card, the Academic and Examination Board approves it, in this order. Each step needs one of its people to approve, unless it is set to need all of them. If anyone turns it down, the grade stays as it is and the teacher is told.',
};

/**
 * The two grade-change routes, short enough for one line of the /sis readiness
 * strip or one cell of its drill. The long names above belong on the settings
 * screen.
 */
export const GRADE_CHANGE_FLOW_SHORT_LABELS: Record<
  GradeChangeApprovalFlow,
  string
> = {
  'markbook.grade_change': 'Grade changes before publishing',
  'markbook.grade_change_aeb': 'Grade changes after publishing',
};

/**
 * The example in the "Step name" box when a step is added, per flow.
 *
 * ⚠ PER FLOW BECAUSE ONE EXAMPLE READ WRONG ON TWO OF THE THREE CARDS. "Officer
 * in charge" is the declarations job; on a grade-change card it suggests a
 * post that has nothing to do with grades. Each stays a JOB, not a person,
 * because the box's own help line says to name the job.
 */
export const STAGE_NAME_EXAMPLES: Record<StagedApprovalFlow, string> = {
  'attendance.student_declaration': 'Officer in charge',
  'markbook.grade_change': 'Grade change approvers',
  'markbook.grade_change_aeb': 'Academic coordinator',
};

// ── How a stage finds its people ────────────────────────────────────────────

export const APPROVAL_RESOLVERS = ['named', 'form_adviser'] as const;
export type ApprovalResolver = (typeof APPROVAL_RESOLVERS)[number];

/**
 * Written for the superadmin choosing between them, not for a developer.
 *
 * ⚠ The `named` line says out loud that adding somebody grants them sight of
 * the filing. For this flow that filing can carry a medical certificate, and a
 * named approver is typically NOT one of the child's teachers, so nothing else
 * in the system would have let them see it. That consequence should be on the
 * screen where the choice is made, not discovered afterwards.
 */
export const APPROVAL_RESOLVER_LABELS: Record<ApprovalResolver, string> = {
  named: 'Specific people',
  form_adviser: "The child's form class adviser",
};

export const APPROVAL_RESOLVER_DESCRIPTIONS: Record<ApprovalResolver, string> =
  {
    named:
      'You choose who. Anyone you add here will be able to open the whole filing, including any medical certificate attached to it.',
    form_adviser:
      'Worked out automatically for each child — whoever advises their class at the time, including a co-adviser and anyone covering the class that week. Nobody has to keep a list up to date.',
  };

// ── How many of a step's people must approve (migration 145) ───────────────
//
// ⚠ 'all' IS ONLY FOR A STEP OF NAMED PEOPLE. Who counts as a class's form
// adviser changes with relief cover, so "everyone" on a form adviser step is a
// set that moves while the step waits. The database refuses it on both
// `approval_stages` and `approval_request_stages`; `CreateApprovalStageSchema`
// refuses it before it gets that far.
//
// ⚠ A STEP WITH NOBODY ON IT NEVER COUNTS AS "EVERYONE APPROVED". It stalls,
// visibly, exactly as an empty 'any' step does.

export const APPROVAL_RULES = ['any', 'all'] as const;
export type ApprovalRule = (typeof APPROVAL_RULES)[number];

export const APPROVAL_RULE_LABELS: Record<ApprovalRule, string> = {
  any: 'Any one of them approves',
  all: 'Everyone must approve',
};

/** Said when 'all' is asked of a form adviser step. */
export const APPROVAL_RULE_ALL_NEEDS_NAMED =
  'Only a step with named people can need everyone to approve.';

// ── Which half of the school a named approver covers ────────────────────────
//
// ⚠ THE SCHOOL'S "PRIMARY OR SECONDARY" IS THE YEAR CATEGORY, NOT A
// FIRST-AND-SECOND APPROVER. Ms Lhen is the officer in charge OF PRIMARY, Ms
// Elaine of SECONDARY, and a child gets exactly one of them. Reading it the
// other way — which is what shipped for a few hours on 2026-08-27 — let each
// of them decide the other half's children. See migration 128.
//
// Matches `levels.level_type`. Only primary and secondary are live at HFSE.

export const APPROVER_LEVEL_SCOPES = [
  'primary',
  'secondary',
  'preschool',
] as const;
export type ApproverLevelScope = (typeof APPROVER_LEVEL_SCOPES)[number];

/** `null` is the default and means every child, whichever half they are in. */
export const APPROVER_LEVEL_SCOPE_LABELS: Record<ApproverLevelScope, string> = {
  primary: 'Primary only',
  secondary: 'Secondary only',
  preschool: 'Preschool only',
};

export const APPROVER_LEVEL_SCOPE_ANY_LABEL = 'Every child';

/** How a scope reads on a chip next to somebody's name. */
export function approverScopeLabel(
  scope: ApproverLevelScope | null | undefined
): string {
  return scope
    ? APPROVER_LEVEL_SCOPE_LABELS[scope]
    : APPROVER_LEVEL_SCOPE_ANY_LABEL;
}

// ── Stage status, as the school reads it ────────────────────────────────────

export const APPROVAL_STAGE_STATUS_VALUES = [
  'waiting',
  'pending',
  'approved',
  'rejected',
  // Migration 144. The request was withdrawn while this step was live. Nobody
  // on the step decided it, so it carries no decider.
  'cancelled',
] as const;
export type ApprovalStageStatus = (typeof APPROVAL_STAGE_STATUS_VALUES)[number];

export const APPROVAL_STAGE_STATUS_LABELS: Record<ApprovalStageStatus, string> =
  {
    waiting: 'Not yet',
    pending: 'Waiting for a decision',
    approved: 'Approved',
    rejected: 'Turned down',
    cancelled: 'Cancelled',
  };

export const APPROVAL_REQUEST_STATUS_VALUES = [
  'pending',
  'approved',
  'rejected',
  'cancelled',
] as const;
export type ApprovalRequestStatus =
  (typeof APPROVAL_REQUEST_STATUS_VALUES)[number];

// ── What the RPC can answer ─────────────────────────────────────────────────

export const APPROVAL_OUTCOMES = [
  'advanced',
  'completed',
  'rejected',
  // Migration 145. An approval on an 'all' step that still waits on others:
  // the person's yes is kept, and the step has not moved.
  'recorded',
  'stage_already_decided',
  'not_authorised',
  // Migration 145. This person already approved this 'all' step.
  'already_approved',
  'request_closed',
  'request_not_found',
] as const;
export type ApprovalOutcome = (typeof APPROVAL_OUTCOMES)[number];

/**
 * What `approval_reevaluate_stage` (migration 145) can answer — asked after
 * the people on a waiting 'all' step change, in case the one person still to
 * approve has just been taken off it.
 */
export const APPROVAL_REEVALUATE_OUTCOMES = [
  'advanced',
  'completed',
  'unchanged',
] as const;
export type ApprovalReevaluateOutcome =
  (typeof APPROVAL_REEVALUATE_OUTCOMES)[number];

/**
 * What `approval_repoint_request_stage` (migration 146) can answer — asked for
 * each in-flight copy of a step whose people or rule the school just changed.
 *
 * 'skipped' — the request had closed, or the step had been decided, by the
 * time the lock was held; nothing was written. 'unchanged' — the step was
 * brought in line and did not move. 'advanced' / 'completed' — the live step's
 * new terms were already met, so it closed and the request moved on.
 */
export const APPROVAL_REPOINT_OUTCOMES = [
  'advanced',
  'completed',
  'unchanged',
  'skipped',
] as const;
export type ApprovalRepointOutcome = (typeof APPROVAL_REPOINT_OUTCOMES)[number];

/** What `approval_cancel` (migration 144) can answer. */
export const APPROVAL_CANCEL_OUTCOMES = [
  'cancelled',
  'request_closed',
  'request_not_found',
] as const;
export type ApprovalCancelOutcome = (typeof APPROVAL_CANCEL_OUTCOMES)[number];

// ── Payloads ────────────────────────────────────────────────────────────────

export const APPROVAL_NOTE_MAX = 300;
export const APPROVAL_STAGE_LABEL_MAX = 80;

/**
 * ⚠ THE NOTE IS OPTIONAL ON APPROVE AND REQUIRED ON REJECT, and the asymmetry
 * is the whole point.
 *
 * On an approval the note travels to the next approver, so it is a convenience.
 * On a rejection there IS no next approver — `approval_advance` closes the
 * request and leaves every later stage `waiting` — so the note's only possible
 * reader is the person who filed. Until this rule existed, a parent turned down
 * saw "Not approved" and nothing else: no reason in the portal, none in an
 * email, and deliberately none in `audit_log`. A rejection with no reason is
 * the exact failure the requirement exists to prevent, so it is refused here
 * rather than merely discouraged on screen.
 *
 * Enforced in the schema and not in the route so the sheet and the server test
 * the same rule — `components`-side validation imports this too.
 */
export const DecideApprovalSchema = z
  .object({
    action: z.enum(['approve', 'reject']),
    // Measured on the words. The note is written in a formatting editor, so
    // the stored string carries tags the approver never typed and cannot see;
    // counting those would refuse a note the on-screen counter calls fine.
    note: z
      .string()
      .trim()
      .refine((s) => proseLength(s) <= APPROVAL_NOTE_MAX, {
        message: `Keep the note to ${APPROVAL_NOTE_MAX} characters or fewer.`,
      })
      .optional(),
  })
  // ⚠ AND THE "GIVE A REASON" RULE HAS TO ASK THE SAME QUESTION. An approver
  // who clicks into the note box and types nothing leaves `<p></p>` behind —
  // seven characters, which `.trim().length > 0` waves through. That is
  // precisely the rejection-with-no-reason this rule was written to refuse,
  // and the parent would have been shown an empty reason.
  .refine((v) => v.action !== 'reject' || !isEmptyRichText(v.note), {
    message:
      'Say why you are turning this down. The parent is shown this as the reason.',
    path: ['note'],
  });
export type DecideApprovalInput = z.infer<typeof DecideApprovalSchema>;

export const CreateApprovalStageSchema = z
  .object({
    flow: z.enum(STAGED_APPROVAL_FLOWS),
    label: z
      .string()
      .trim()
      .min(1, 'Give this step a name.')
      .max(
        APPROVAL_STAGE_LABEL_MAX,
        `Keep the name to ${APPROVAL_STAGE_LABEL_MAX} characters or fewer.`
      ),
    resolver: z.enum(APPROVAL_RESOLVERS),
    /** Omitted means 'any' — applied by the server, not here. */
    approval_rule: z.enum(APPROVAL_RULES).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.approval_rule === 'all' && v.resolver !== 'named') {
      ctx.addIssue({
        code: 'custom',
        message: APPROVAL_RULE_ALL_NEEDS_NAMED,
        path: ['approval_rule'],
      });
    }
  });
export type CreateApprovalStageInput = z.infer<
  typeof CreateApprovalStageSchema
>;

export const UpdateApprovalStageSchema = z
  .object({
    label: z
      .string()
      .trim()
      .min(1, 'Give this step a name.')
      .max(APPROVAL_STAGE_LABEL_MAX)
      .optional(),
    /** 'up' / 'down' rather than an absolute position — see lib/approvals/config.ts. */
    move: z.enum(['up', 'down']).optional(),
    is_active: z.boolean().optional(),
    /**
     * ⚠ THIS SCHEMA CANNOT KNOW THE STEP'S RESOLVER, so 'all' on a form
     * adviser step is refused by the route (which reads the step) and, behind
     * it, by migration 145's CHECK.
     */
    approval_rule: z.enum(APPROVAL_RULES).optional(),
  })
  .refine(
    (v) =>
      v.label !== undefined ||
      v.move !== undefined ||
      v.is_active !== undefined ||
      v.approval_rule !== undefined,
    { message: 'Nothing to change.' }
  );
export type UpdateApprovalStageInput = z.infer<
  typeof UpdateApprovalStageSchema
>;

export const AssignStageApproverSchema = z.object({
  stage_id: z.string().uuid('Pick a step.'),
  user_id: z.string().uuid('Pick a person.'),
  /**
   * Omit, or send null, for somebody who approves for every child. Send a
   * school half when the post is split — which is how HFSE's officer in charge
   * actually works.
   */
  applies_to_level_type: z.enum(APPROVER_LEVEL_SCOPES).nullish(),
});
export type AssignStageApproverInput = z.infer<
  typeof AssignStageApproverSchema
>;
