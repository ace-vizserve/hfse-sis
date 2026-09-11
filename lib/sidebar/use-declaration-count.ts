'use client';

import { DECLARATION_APPROVAL_FLOW } from '@/lib/schemas/approval-flows';
import { useStagedApprovalCount } from '@/lib/sidebar/use-staged-approval-count';

// Live count of absence and travel declaration steps waiting for THIS person.
//
// ⚠ A WRAPPER, NOT A SECOND COPY. The subscription, the recount and every
// reason behind their shape live in `use-staged-approval-count.ts`; this only
// pins the flow. Kept so the sidebar badge and the header bell keep calling the
// name they already call, and so a test can mock the declaration count alone.
//
// ⚠ Module-level constant, not an inline `[...]`: the generic hook keys its
// subscription on the flow list's content, but there is no reason to make it
// work for that on every render.
const DECLARATION_FLOWS = [DECLARATION_APPROVAL_FLOW] as const;

export function useDeclarationCount(
  userId: string,
  initial: number | null
): number | null {
  return useStagedApprovalCount(userId, DECLARATION_FLOWS, initial);
}
