import { z } from 'zod';

// Ordered, configurable approval flows — the vocabulary shared by the engine,
// the config screen and the decide route.
//
// ⚠ THIS IS DELIBERATELY NOT `lib/schemas/approvers.ts`.
//
// That file's `APPROVER_FLOWS` describes a different mechanism: a flat POOL of
// approvers where a teacher picks two and whichever acts first becomes
// "primary". A `>= 2 approvers` rule is hardcoded against that tuple in five
// places — `lib/sis/approver-readiness.ts`, `lib/sis/health.ts`,
// `lib/sis/hub-attention.ts`, the Request-edit button and the approvers page's
// own prose — and only two of those route through the classifier. Adding a
// staged flow to that tuple would render "at least 2 approvers per flow" over a
// flow whose actual rule is "at least one person in each NAMED stage", which is
// a wrong instruction shown to the person configuring it.
//
// So staged flows live here, in parallel, and nothing existing moves.

export const STAGED_APPROVAL_FLOWS = [
  'attendance.student_declaration',
] as const;
export type StagedApprovalFlow = (typeof STAGED_APPROVAL_FLOWS)[number];

export const STAGED_FLOW_LABELS: Record<StagedApprovalFlow, string> = {
  'attendance.student_declaration':
    'Attendance · Absence and travel declarations',
};

export const STAGED_FLOW_DESCRIPTIONS: Record<StagedApprovalFlow, string> = {
  'attendance.student_declaration':
    'When a parent files an absence or a travel declaration, these people approve it in this order. Each step needs only one of its people to act. If anyone turns it down, it stops there and the parent is told.',
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
      'You choose who. Any one of them can approve this step. Anyone you add here will be able to open the whole filing, including any medical certificate attached to it.',
    form_adviser:
      'Worked out automatically for each child — whoever advises their class at the time, including a co-adviser and anyone covering the class that week. Nobody has to keep a list up to date.',
  };

// ── Stage status, as the school reads it ────────────────────────────────────

export const APPROVAL_STAGE_STATUS_VALUES = [
  'waiting',
  'pending',
  'approved',
  'rejected',
] as const;
export type ApprovalStageStatus = (typeof APPROVAL_STAGE_STATUS_VALUES)[number];

export const APPROVAL_STAGE_STATUS_LABELS: Record<ApprovalStageStatus, string> =
  {
    waiting: 'Not yet',
    pending: 'Waiting for a decision',
    approved: 'Approved',
    rejected: 'Turned down',
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
  'stage_already_decided',
  'not_authorised',
  'request_closed',
  'request_not_found',
] as const;
export type ApprovalOutcome = (typeof APPROVAL_OUTCOMES)[number];

// ── Payloads ────────────────────────────────────────────────────────────────

export const APPROVAL_NOTE_MAX = 300;
export const APPROVAL_STAGE_LABEL_MAX = 80;

export const DecideApprovalSchema = z.object({
  action: z.enum(['approve', 'reject']),
  note: z
    .string()
    .trim()
    .max(
      APPROVAL_NOTE_MAX,
      `Keep the note to ${APPROVAL_NOTE_MAX} characters or fewer.`
    )
    .optional(),
});
export type DecideApprovalInput = z.infer<typeof DecideApprovalSchema>;

export const CreateApprovalStageSchema = z.object({
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
  })
  .refine(
    (v) =>
      v.label !== undefined ||
      v.move !== undefined ||
      v.is_active !== undefined,
    { message: 'Nothing to change.' }
  );
export type UpdateApprovalStageInput = z.infer<
  typeof UpdateApprovalStageSchema
>;

export const AssignStageApproverSchema = z.object({
  stage_id: z.string().uuid('Pick a step.'),
  user_id: z.string().uuid('Pick a person.'),
});
export type AssignStageApproverInput = z.infer<
  typeof AssignStageApproverSchema
>;
