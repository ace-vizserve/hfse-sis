import {
  APPROVER_LEVEL_SCOPE_LABELS,
  type ApprovalResolver,
  type ApproverLevelScope,
  type StagedApprovalFlow,
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
  /**
   * Which half of the school this person approves for. `null` = every child.
   *
   * ⚠ Migration 128. HFSE's officer in charge is TWO posts, one per half — Ms
   * Lhen for Primary, Ms Elaine for Secondary — and reading "Primary or
   * Secondary" as two interchangeable approvers let each of them decide the
   * other half's children.
   */
  appliesToLevelType: ApproverLevelScope | null;
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
    approvers: Array<{ appliesToLevelType?: ApproverLevelScope | null }>;
  }>,
  /**
   * The halves of the school that actually have classes right now, so the
   * check below can tell "nobody covers Secondary" from "this school has no
   * secondary". Omit it and the half-coverage check is skipped entirely —
   * every caller that has not been taught to load levels keeps its old
   * behaviour rather than inventing a warning from an assumed school shape.
   */
  levelTypesInUse?: ApproverLevelScope[]
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

  // ⚠ A step can have people on it and still stall for half the school.
  //
  // If everybody on a step is limited to one half — which is exactly what the
  // officer in charge looks like — then children in an uncovered half reach
  // that step and stop. Nothing hands them to the other half's officer and
  // nothing skips the step, so this has to be said out loud on the screen
  // rather than discovered when a parent asks why nothing happened.
  const gap = findFirstHalfCoverageGap(stages, levelTypesInUse);
  if (gap) {
    const halves = gap.missing.map(halfName).join(' and ');
    return {
      tone: 'destructive',
      label: `Nobody covers ${halves}`,
      warning: `On “${gap.stageLabel}”, nobody is set to approve for ${halves}. Those children’s requests will reach that step and stop there. Add someone for ${halves}, or set an existing person to cover every child.`,
    };
  }

  return {
    tone: 'mint',
    label:
      stages.length === 1 ? 'Ready — 1 step' : `Ready — ${stages.length} steps`,
    warning: null,
  };
}

/** "Primary only" → "Primary", for reading inside a sentence. */
function halfName(scope: ApproverLevelScope): string {
  return APPROVER_LEVEL_SCOPE_LABELS[scope].replace(' only', '');
}

/**
 * The first named step that leaves some half of the school with nobody.
 *
 * A single untagged person on a step covers everybody, so the step is fine
 * however many tagged people sit beside them — that is what `null` means.
 * Returns `null` when every step is covered, or when the caller did not say
 * which halves the school actually runs.
 */
export function findFirstHalfCoverageGap(
  stages: Array<{
    label: string;
    resolver: ApprovalResolver;
    approvers: Array<{ appliesToLevelType?: ApproverLevelScope | null }>;
  }>,
  levelTypesInUse?: ApproverLevelScope[]
): { stageLabel: string; missing: ApproverLevelScope[] } | null {
  if (!levelTypesInUse || levelTypesInUse.length === 0) return null;

  for (const stage of stages) {
    if (stage.resolver !== 'named') continue;
    if (stage.approvers.length === 0) continue; // already reported above
    const coversEveryone = stage.approvers.some(
      (a) => (a.appliesToLevelType ?? null) === null
    );
    if (coversEveryone) continue;

    const covered = new Set(
      stage.approvers
        .map((a) => a.appliesToLevelType)
        .filter((s): s is ApproverLevelScope => Boolean(s))
    );
    const missing = levelTypesInUse.filter((t) => !covered.has(t));
    if (missing.length > 0) return { stageLabel: stage.label, missing };
  }
  return null;
}
