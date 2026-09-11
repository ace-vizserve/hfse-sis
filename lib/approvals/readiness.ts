import {
  APPROVER_LEVEL_SCOPE_LABELS,
  DECLARATION_APPROVAL_FLOW,
  GRADE_CHANGE_AEB_APPROVAL_FLOW,
  GRADE_CHANGE_APPROVAL_FLOW,
  type ApprovalResolver,
  type ApprovalRule,
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
   * True when the row names somebody with no staff account any more — deleted,
   * or no longer holding a staff role. Optional so callers that build this
   * view by hand keep compiling; missing reads as false.
   */
  removed?: boolean;
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
  /**
   * Whether one person on the step is enough (`any`) or everyone on it must
   * approve (`all`). Always `any` on a form adviser step — who advises a class
   * changes when somebody covers it, so "everyone" has no fixed meaning there.
   */
  approvalRule: ApprovalRule;
  approvers: StageApproverView[];
};

/**
 * Can this step be set to "Everyone must approve"?
 *
 * ⚠ ONLY A STEP WITH NAMED PEOPLE. A form adviser step works its people out
 * each time somebody acts — a co-adviser, a relief teacher covering this week —
 * so "everyone" would be a list that changes under a request while it waits.
 * The database refuses it too (migration 145); this is what lets the screen
 * say so before the click rather than after.
 */
export function canRequireEveryone(resolver: ApprovalResolver): boolean {
  return resolver === 'named';
}

export type FlowConfig = {
  flow: StagedApprovalFlow;
  stages: StageView[];
};

export type StagedFlowReadiness = {
  tone: 'mint' | 'destructive';
  label: string;
  warning: string | null;
};

/** The minimum a readiness check needs to know about one step. */
export type ReadinessStage = {
  label: string;
  resolver: ApprovalResolver;
  /** Omitted by callers that predate the setting; reads as `any`. */
  approvalRule?: ApprovalRule;
  approvers: Array<{
    appliesToLevelType?: ApproverLevelScope | null;
    /** For the turned-off-account checks. Omitted reads as nobody named. */
    displayName?: string;
    /** The account is turned off. Omitted reads as false. */
    disabled?: boolean;
    /** The account no longer exists as a staff account. Omitted reads as false. */
    removed?: boolean;
  }>;
};

/**
 * Is this one of the two grade-change flows?
 *
 * Private on purpose: `lib/change-requests/staged-flows.ts` exports the
 * app-wide type guard of the same name. Importing it here would make the
 * approvals engine depend on one of its own subjects.
 */
function isGradeChangeFlow(
  flow: StagedApprovalFlow | null | undefined
): boolean {
  return (
    flow === GRADE_CHANGE_APPROVAL_FLOW ||
    flow === GRADE_CHANGE_AEB_APPROVAL_FLOW
  );
}

/**
 * Can this flow actually finish?
 *
 * ⚠ One person on each NAMED step is enough, and a derived step needs nobody
 * listed at all. That is a different rule from the retired two-approver pool
 * ("at least 2 approvers"), which grade change requests used until they moved
 * onto steps.
 *
 * ⚠ The empty-named-step case is the LIVE one today. Nobody at HFSE holds the
 * "Officer in Charge" post yet, so a declaration will clear the adviser and
 * then stop. It is not skipped — silently stepping over an approval step is
 * the worst possible default — so this has to say so loudly instead.
 *
 * ⚠ THE WORDING DEPENDS ON WHO FILES, which is why `flow` is passed. A parent
 * files a declaration and it waits; a teacher CANNOT file a grade change at
 * all until its steps are set up, so "anything parents file will sit waiting"
 * shown over a grade-change card is a wrong instruction. Without `flow` the
 * warnings name nobody — they are true of every flow.
 */
export function classifyStagedFlowReadiness(
  stages: ReadinessStage[],
  /**
   * The halves of the school that actually have classes right now, so the
   * check below can tell "nobody covers Secondary" from "this school has no
   * secondary". Omit it and the half-coverage check is skipped entirely —
   * every caller that has not been taught to load levels keeps its old
   * behaviour rather than inventing a warning from an assumed school shape.
   */
  levelTypesInUse?: ApproverLevelScope[],
  /** Which flow these steps belong to — decides who the warning talks about. */
  flow?: StagedApprovalFlow
): StagedFlowReadiness {
  const gradeChange = isGradeChangeFlow(flow);

  if (stages.length === 0) {
    return {
      tone: 'destructive',
      label: 'No steps set up',
      warning: gradeChange
        ? 'Teachers can’t file this kind of grade change request until you add at least one step and put someone on it.'
        : flow === DECLARATION_APPROVAL_FLOW
          ? 'Nothing can be approved until you add at least one step. Anything parents file in the meantime will sit waiting.'
          : 'Nothing can be approved until you add at least one step.',
    };
  }
  // ⚠ WHATEVER THE STEP'S SETTING. An "Everyone must approve" step with nobody
  // on it is exactly as stuck as an "any one of them" step with nobody on it —
  // an empty list is never "everyone has approved" (migration 145 refuses to
  // read it that way) — so it is reported in the same words, not a new warning
  // a reader would have to learn.
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
      warning: gradeChange
        ? `Nobody is on ${names}, so teachers can’t file this kind of grade change request until you add someone.`
        : `Nothing can get past ${names} until you add someone. Requests will reach that step and stop there.`,
    };
  }

  // ⚠ A step can have people on it and nobody able to act (disabled or
  // removed accounts). On an "Everyone must approve" step ONE such person is
  // enough to stall every request: the step waits for a yes that cannot come,
  // and nothing on the request says why. On an "any one of them" step it takes
  // all of them. Both are reported before the half-coverage check — the fix
  // is about a named person, which is the clearer instruction.
  const stuck = findFirstStuckStep(stages);
  if (stuck) {
    const who = stuck.person;
    const what = accountProblem(who);
    return {
      tone: 'destructive',
      label: `“${stuck.stageLabel}” can’t finish`,
      warning: who.removed
        ? `${nameOf(who)} ${what}, so requests at “${stuck.stageLabel}” can’t finish. Remove them from the step.`
        : `${nameOf(who)}’s account ${what}, so requests at “${stuck.stageLabel}” can’t finish. Remove them from the step or turn the account back on.`,
    };
  }

  // ⚠ A step can have people on it and still stall for half the school.
  //
  // If everybody on a step is limited to one half — which is exactly what the
  // officer in charge looks like — then children in an uncovered half reach
  // that step and stop. Nothing hands them to the other half's officer and
  // nothing skips the step, so this has to be said out loud on the screen
  // rather than discovered when a parent asks why nothing happened.
  //
  // ⚠ A GRADE CHANGE NEVER REACHES THE GAP. The filing route works out the
  // class's half first and refuses a request whose step has nobody for it
  // (lib/change-requests/ladder-summary.ts, `gradeChangeLadderProblem`), so
  // for those flows the consequence is that teachers of that half cannot file
  // — not that requests stall.
  const gap = findFirstHalfCoverageGap(stages, levelTypesInUse);
  if (gap) {
    const halves = gap.missing.map(halfName).join(' and ');
    const fix = `Add someone for ${halves}, or set an existing person to cover every child.`;
    return {
      tone: 'destructive',
      label: `Nobody covers ${halves}`,
      warning: gradeChange
        ? `On “${gap.stageLabel}”, nobody is set to approve for ${halves}, so teachers of ${halves} classes can’t file this kind of grade change request. ${fix}`
        : `On “${gap.stageLabel}”, nobody is set to approve for ${halves}. Those children’s requests will reach that step and stop there. ${fix}`,
    };
  }

  // Not blocking, but worth saying: somebody on an "any one of them" step
  // whose account is off simply cannot be the one who approves. Everyone else
  // on the step still can, so the flow is ready — with a line saying who is
  // out, so nobody waits on them.
  const idle = findFirstIdleApprover(stages);
  return {
    tone: 'mint',
    label:
      stages.length === 1 ? 'Ready — 1 step' : `Ready — ${stages.length} steps`,
    warning: idle
      ? idle.person.removed
        ? `${nameOf(idle.person)} on “${idle.stageLabel}” ${accountProblem(idle.person)}, so they can’t approve. Anyone else on the step still can.`
        : `${nameOf(idle.person)}’s account on “${idle.stageLabel}” ${accountProblem(idle.person)}, so they can’t approve. Anyone else on the step still can.`
      : null,
  };
}

type ReadinessApprover = ReadinessStage['approvers'][number];

function cannotAct(person: ReadinessApprover): boolean {
  return person.disabled === true || person.removed === true;
}

/** "is turned off" / "no longer has a staff account" — read inside a sentence. */
function accountProblem(person: ReadinessApprover): string {
  return person.removed ? 'no longer has a staff account' : 'is turned off';
}

function nameOf(person: ReadinessApprover): string {
  const name = person.displayName?.trim();
  // `loadFlowConfig` writes this placeholder for a row whose account is gone.
  return name && name !== '(account removed)' ? name : 'Someone';
}

/**
 * The first named step no request can get past because of who is on it: an
 * "Everyone must approve" step with anybody on it who cannot act, or an "any
 * one of them" step on which nobody can. Empty steps are reported earlier.
 */
function findFirstStuckStep(
  stages: ReadinessStage[]
): { stageLabel: string; person: ReadinessApprover } | null {
  for (const stage of stages) {
    if (stage.resolver !== 'named' || stage.approvers.length === 0) continue;
    const out = stage.approvers.filter(cannotAct);
    if (out.length === 0) continue;
    const everyone = (stage.approvalRule ?? 'any') === 'all';
    if (everyone || out.length === stage.approvers.length) {
      return { stageLabel: stage.label, person: out[0] };
    }
  }
  return null;
}

/** The first person who cannot act on a step that others on it can still carry. */
function findFirstIdleApprover(
  stages: ReadinessStage[]
): { stageLabel: string; person: ReadinessApprover } | null {
  for (const stage of stages) {
    if (stage.resolver !== 'named') continue;
    const person = stage.approvers.find(cannotAct);
    if (person) return { stageLabel: stage.label, person };
  }
  return null;
}

/**
 * One short line per step, in order, for the "who approves this" preview at
 * the top of each card: "Ms Chandana → Ms Christina → Ms Norma → Mr Gary or
 * Ms Nina".
 *
 * A step reads as its PEOPLE when there are several of them interchangeably
 * ("Mr Gary or Ms Nina"), and as its NAME otherwise. A step where everyone must
 * approve joins them with "and" instead ("Mr Gary and Ms Nina") — the one word
 * that tells the reader both signatures are needed.
 *
 * ⚠ A step whose people are limited to halves of the school reads as its name,
 * NOT "Ms Lhen or Ms Elaine". Those two are not interchangeable — a child gets
 * exactly one of them — and "or" is precisely the misreading that let each of
 * them decide the other half's children (migration 128).
 *
 * A long list is cut short after three names, so one step cannot push the rest
 * of the line off the card.
 */
export function describeStepsInOrder(
  stages: Array<{
    label: string;
    resolver: ApprovalResolver;
    approvalRule?: ApprovalRule;
    approvers: Array<{
      displayName: string;
      appliesToLevelType?: ApproverLevelScope | null;
    }>;
  }>
): Array<{ text: string; empty: boolean }> {
  const MAX_NAMES = 3;
  return stages.map((stage) => {
    if (stage.resolver !== 'named') return { text: stage.label, empty: false };
    if (stage.approvers.length === 0) return { text: stage.label, empty: true };

    const scoped = stage.approvers.some((a) => a.appliesToLevelType);
    // Somebody named twice (once per half) is still one person.
    const names = [...new Set(stage.approvers.map((a) => a.displayName))];
    if (scoped || names.length < 2) return { text: stage.label, empty: false };

    return {
      text: joinNames(names, stage.approvalRule === 'all' ? 'and' : 'or', {
        max: MAX_NAMES,
      }),
      empty: false,
    };
  });
}

/**
 * "A or B", "A, B or C", "A, B, C or 2 others" — and the same with "and".
 *
 * Shared with the SIS drill's "Who approves" cell, so the approvers screen and
 * the drill never disagree about which word a step gets.
 */
export function joinNames(
  names: readonly string[],
  word: 'and' | 'or',
  opts: { max?: number } = {}
): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  const max = opts.max ?? Number.POSITIVE_INFINITY;
  if (names.length <= max) {
    return `${names.slice(0, -1).join(', ')} ${word} ${names[names.length - 1]}`;
  }
  const rest = names.length - max;
  return `${names.slice(0, max).join(', ')} ${word} ${rest} ${rest === 1 ? 'other' : 'others'}`;
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
  stages: ReadinessStage[],
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
