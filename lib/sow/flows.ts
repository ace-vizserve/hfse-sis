// No `import 'server-only'`: the header bell and the sidebar badge are client
// components, and they read this.

import {
  SOW_APPROVAL_FLOW,
  type StagedApprovalFlow,
} from '@/lib/schemas/approval-flows';

/**
 * The scheme-of-work approval flow, named once for everything that counts it
 * (the bell, the "Schemes to review" badge, their server seeds).
 *
 * ⚠ A MODULE CONSTANT, NOT AN INLINE `[...]` AT EACH CALL SITE — the same
 * reason as `GRADE_CHANGE_FLOWS`: the live count hook keys its subscription on
 * the list's content, and one frozen tuple keeps that trivially stable.
 */
export const SOW_FLOWS: readonly StagedApprovalFlow[] = [
  SOW_APPROVAL_FLOW,
] as const;
