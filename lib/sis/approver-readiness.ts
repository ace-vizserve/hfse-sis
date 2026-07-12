// Pure. A locked-sheet change request requires a primary AND a distinct
// secondary approver from the flow's assigned list (app/api/change-requests/
// route.ts's filing validation) — a flow with 0 or 1 assigned approvers
// silently makes filing impossible on that flow. This classifier surfaces
// that as a loud, named state instead of a bare count.

export type ApproverReadiness = {
  tone: 'mint' | 'destructive';
  label: string;
  warning: string | null;
};

export function classifyApproverReadiness(
  approverCount: number
): ApproverReadiness {
  if (approverCount >= 2) {
    return {
      tone: 'mint',
      label: `Ready — ${approverCount} approvers`,
      warning: null,
    };
  }
  if (approverCount === 1) {
    return {
      tone: 'destructive',
      label: 'Only 1 approver',
      warning:
        'A correction needs two different approvers. With only one assigned, no one can file a request on this flow — add a second person now.',
    };
  }
  return {
    tone: 'destructive',
    label: 'No approvers assigned',
    warning:
      'No one can file a request on this flow until at least two approvers are assigned.',
  };
}
