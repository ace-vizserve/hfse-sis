// No `import 'server-only'`: the header bell is a client component, and it
// reads this.

import { GRADE_CHANGE_FLOWS } from '@/lib/change-requests/staged-flows';
import {
  SOW_APPROVAL_FLOW,
  type StagedApprovalFlow,
} from '@/lib/schemas/approval-flows';

/**
 * The ordered-approval flows the bell counts in ONE read: both grade-change
 * flows and the scheme-of-work flow.
 *
 * ⚠ ONE LIST, ONE QUERY. The scheme-of-work flow joined the bell by widening
 * this list, not by adding a second count: every module layout seeds it on
 * every page and the bell recounts it on every realtime ping, so a separate
 * SOW count would have been one more read on every page for everyone.
 *
 * ⚠ A MODULE CONSTANT — the live count hook keys its subscription on the
 * list's content, and one frozen tuple keeps that trivially stable.
 */
export const BELL_STAGED_FLOWS: readonly StagedApprovalFlow[] = [
  ...GRADE_CHANGE_FLOWS,
  SOW_APPROVAL_FLOW,
] as const;
