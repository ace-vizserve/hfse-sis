import type {
  ApprovalResolver,
  StagedApprovalFlow,
} from '@/lib/schemas/approval-flows';

// The shapes and the one pure rule the CONFIG SCREEN needs.
//
// ⚠ SEPARATE FROM `./config.ts` ON PURPOSE, and not for tidiness. That module
// is `server-only`, so importing a VALUE from it into a client component
// throws at runtime — and TypeScript does not catch it, because a type-only
// import is erased while a function import is not. The editor needs this
// classifier in the browser, so it lives where the browser can have it.

export type StageApproverView = {
  id: string;
  userId: string;
  email: string;
  displayName: string;
  role: string | null;
  disabled: boolean;
};

export type StageView = {
  id: string;
  flow: StagedApprovalFlow;
  stageOrder: number;
  label: string;
  resolver: ApprovalResolver;
  approvers: StageApproverView[];
};

export type FlowConfig = {
  flow: StagedApprovalFlow;
  stages: StageView[];
};

export type StagedFlowReadiness = {
  tone: 'mint' | 'destructive';
  label: string;
  warning: string | null;
};

/**
 * Can this flow actually finish?
 *
 * ⚠ A SIBLING of `classifyApproverReadiness`, not a change to it. That one
 * encodes "at least 2 approvers per flow", which is the pooled
 * change-request rule and is simply a different rule: a staged flow needs at
 * least one person on each NAMED step, and no people at all on a derived one.
 * The older rule is written out in five places across the codebase and none of
 * them moves for this.
 *
 * ⚠ The empty-named-step case is the LIVE one today. Nobody at HFSE holds the
 * "Officer in Charge" post yet, so a declaration will clear the adviser and
 * then stop. It is not skipped — silently stepping over an approval step is
 * the worst possible default — so this has to say so loudly instead.
 */
export function classifyStagedFlowReadiness(
  stages: Array<{
    label: string;
    resolver: ApprovalResolver;
    approvers: unknown[];
  }>
): StagedFlowReadiness {
  if (stages.length === 0) {
    return {
      tone: 'destructive',
      label: 'No steps set up',
      warning:
        'Nothing can be approved until you add at least one step. Anything parents file in the meantime will sit waiting.',
    };
  }
  const empty = stages.filter(
    (s) => s.resolver === 'named' && s.approvers.length === 0
  );
  if (empty.length > 0) {
    const names = empty.map((s) => `“${s.label}”`).join(', ');
    return {
      tone: 'destructive',
      label:
        empty.length === 1
          ? '1 step has nobody in it'
          : `${empty.length} steps have nobody in them`,
      warning: `Nothing can get past ${names} until you add someone. Requests will reach that step and stop there.`,
    };
  }
  return {
    tone: 'mint',
    label:
      stages.length === 1 ? 'Ready — 1 step' : `Ready — ${stages.length} steps`,
    warning: null,
  };
}
