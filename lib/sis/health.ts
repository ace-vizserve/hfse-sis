import 'server-only';
import { unstable_cache } from 'next/cache';

import { listLevelTypesInUse, loadFlowConfig } from '@/lib/approvals/config';
import {
  classifyStagedFlowReadiness,
  type ReadinessStage,
  type StagedFlowReadiness,
} from '@/lib/approvals/readiness';
import {
  GRADE_CHANGE_AEB_APPROVAL_FLOW,
  GRADE_CHANGE_APPROVAL_FLOW,
  GRADE_CHANGE_FLOW_SHORT_LABELS,
  type ApproverLevelScope,
  type GradeChangeApprovalFlow,
} from '@/lib/schemas/approval-flows';
import { createServiceClient } from '@/lib/supabase/service';

// System-health strip data for /sis. This is NOT a full dashboard — it's a
// thin readiness summary on the SIS Admin hub landing. Two signals:
// (1) AY configuration state, (2) whether grade change requests can be filed.
//
// ⚠ SIGNAL (2) USED TO COUNT `approver_assignments` AND CALL >= 2 "OK". That
// was the two-approver pool, and grade change requests no longer use it: they
// go through ordered steps (`markbook.grade_change` before the report card is
// published, `markbook.grade_change_aeb` after), and a teacher cannot file one
// until its steps are set up. So readiness is now the same classifier the
// approvers screen shows, over the same configuration, and the two cannot
// disagree about whether a kind of request is ready.

const CACHE_TTL_SECONDS = 60;

/** The two grade-change flows, in the order a request meets them in a year. */
const GRADE_CHANGE_FLOWS: GradeChangeApprovalFlow[] = [
  GRADE_CHANGE_APPROVAL_FLOW,
  GRADE_CHANGE_AEB_APPROVAL_FLOW,
];

// Short on purpose — these sit on one line of the strip and one row of the
// hub's attention feed. The long names live in `STAGED_FLOW_LABELS`. Shared
// with the strip's drill, so the row you click and the list it opens use the
// same words.
const FLOW_LABELS = GRADE_CHANGE_FLOW_SHORT_LABELS;

export type ApprovalFlowHealth = {
  flow: GradeChangeApprovalFlow;
  label: string;
  stepCount: number;
  ok: boolean;
  readiness: StagedFlowReadiness;
  /**
   * The steps in the smallest shape a readiness check needs — no names, no
   * emails — so the hub's attention feed can classify the same steps without
   * a second read, and nobody's address is written into the cache.
   */
  stages: ReadinessStage[];
};

export type SystemHealth = {
  ayCount: number;
  currentAy: { ayCode: string; label: string } | null;
  approverFlows: ApprovalFlowHealth[];
  /** Halves of the school with classes this year — the input readiness used. */
  levelTypesInUse: ApproverLevelScope[];
  lastAdminActivityAt: string | null;
};

async function loadSystemHealthUncached(): Promise<SystemHealth> {
  const service = createServiceClient();

  const [aysRes, currentRes, lastAdminRes, flowConfigs, levelTypesInUse] =
    await Promise.all([
      service
        .from('academic_years')
        .select('id', { count: 'exact', head: true }),
      service
        .from('academic_years')
        .select('ay_code, label')
        .eq('is_current', true)
        .maybeSingle(),
      service
        .from('audit_log')
        .select('created_at')
        .or(
          ['ay.', 'approver.', 'approval_stage.']
            .map((p) => `action.like.${p}%`)
            .join(',')
        )
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      // ⚠ These THROW on a database error, and that is wanted: unstable_cache
      // does not store a thrown result, so a blip is not remembered as "no
      // steps set up" for the next minute. The hub page catches it.
      Promise.all(GRADE_CHANGE_FLOWS.map((f) => loadFlowConfig(service, f))),
      listLevelTypesInUse(service),
    ]);

  const approverFlows: ApprovalFlowHealth[] = flowConfigs.map((config) => {
    const stages: ReadinessStage[] = config.stages.map((s) => ({
      label: s.label,
      resolver: s.resolver,
      // The setting and who can act both matter now: one turned-off account on
      // a step that needs everyone stalls it, and the strip must say so.
      approvalRule: s.approvalRule,
      approvers: s.approvers.map((a) => ({
        appliesToLevelType: a.appliesToLevelType,
        displayName: a.displayName,
        disabled: a.disabled,
        removed: a.removed ?? false,
      })),
    }));
    const flow = config.flow as GradeChangeApprovalFlow;
    const readiness = classifyStagedFlowReadiness(
      stages,
      levelTypesInUse,
      flow
    );
    return {
      flow,
      label: FLOW_LABELS[flow],
      stepCount: stages.length,
      ok: readiness.tone === 'mint',
      readiness,
      stages,
    };
  });

  return {
    ayCount: aysRes.count ?? 0,
    currentAy: currentRes.data
      ? {
          ayCode: currentRes.data.ay_code as string,
          label: currentRes.data.label as string,
        }
      : null,
    approverFlows,
    levelTypesInUse,
    lastAdminActivityAt:
      (lastAdminRes.data?.created_at as string | undefined) ?? null,
  };
}

const loadSystemHealth = unstable_cache(
  loadSystemHealthUncached,
  ['sis', 'system-health'],
  {
    // This strip is school-wide by design — it takes no ayCode and counts
    // every AY — so there is no AY-coded tag to scope it with. It gets its own
    // dedicated tag instead, and every write path that changes what the query
    // above selects emits it:
    //   - sis/ay-setup POST / DELETE — create and remove `academic_years`
    //     rows, which move `ayCount` and can move `currentAy`.
    //   - sis/ay-setup PATCH — flips `academic_years.is_current`, which IS
    //     `currentAy`, and changes which year's classes `levelTypesInUse`
    //     reads.
    //   - sis/admin/approval-stages POST, and [id] PATCH / DELETE — add,
    //     rename, reorder and retire `approval_stages` rows.
    //   - sis/admin/approval-stage-approvers POST and [id] DELETE — the only
    //     app writers of `approval_stage_approvers`, which is who is on a step.
    //   - sis/admin/users [id] DELETE, when the account was on a step — the
    //     delete cascades its `approval_stage_approvers` rows away.
    //
    // Things that touch this data and deliberately do NOT emit it:
    //   - sis/admin/approvers POST / [id] DELETE — write `approver_assignments`,
    //     the retired two-approver pool. This loader read that table until
    //     grade changes moved onto steps, and emitted from there for that
    //     reason; nothing cached reads it now.
    //   - sis/ay-setup/accepting-applications — writes
    //     `academic_years.accepting_applications`, a column the query above
    //     does not select.
    //   - Section writes. `levelTypesInUse` reads the current year's sections,
    //     but it only changes when a year gains or loses a whole half of the
    //     school — which happens at year setup, and year setup emits this tag.
    //     A mid-year first Secondary class waits out the 60s TTL.
    //   - The seed script (scripts/seed-grade-change-approval-steps.ts) writes
    //     steps directly, outside any request. The TTL covers it.
    //   - `lastAdminActivityAt`, the one field read from `audit_log`, CANNOT
    //     be tagged: every admin action in the app appends an audit row, so a
    //     tag covering it would fire on nearly every request and turn this
    //     cache into pure overhead. The 60s TTL is that one field's freshness
    //     contract.
    // Don't close a perceived gap by shotgunning the tag onto any of these.
    //
    // The bare 'sis' and 'markbook' tags that used to sit here were removed
    // rather than kept: nothing in the app emits either one bare, so both were
    // inert, and 'sis' must NOT start being emitted — it is exempt on two
    // audit_log activity feeds in lib/sis/dashboard.ts that emitting it would
    // bust as collateral.
    tags: ['sis-health'],
    revalidate: CACHE_TTL_SECONDS,
  }
);

export function getSystemHealth(): Promise<SystemHealth> {
  return loadSystemHealth();
}
