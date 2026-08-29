import 'server-only';
import { unstable_cache } from 'next/cache';

import { APPROVER_FLOWS, type ApproverFlow } from '@/lib/schemas/approvers';
import { createServiceClient } from '@/lib/supabase/service';

// System-health strip data for /sis. This is NOT a full dashboard — it's a
// thin readiness summary on the SIS Admin hub landing. Two signals:
// (1) AY configuration state, (2) approver coverage per flow.

const CACHE_TTL_SECONDS = 60;

export type SystemHealth = {
  ayCount: number;
  currentAy: { ayCode: string; label: string } | null;
  approverFlows: Array<{
    flow: ApproverFlow;
    label: string;
    count: number;
    ok: boolean; // true if >= 2 assigned (teachers require primary + secondary)
  }>;
  lastAdminActivityAt: string | null;
};

async function loadSystemHealthUncached(): Promise<SystemHealth> {
  const service = createServiceClient();

  const [aysRes, currentRes, assignmentsRes, lastAdminRes] = await Promise.all([
    service.from('academic_years').select('id', { count: 'exact', head: true }),
    service
      .from('academic_years')
      .select('ay_code, label')
      .eq('is_current', true)
      .maybeSingle(),
    service.from('approver_assignments').select('flow'),
    service
      .from('audit_log')
      .select('created_at')
      .or(['ay.', 'approver.'].map((p) => `action.like.${p}%`).join(','))
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const flowCounts = new Map<ApproverFlow, number>();
  for (const f of APPROVER_FLOWS) flowCounts.set(f, 0);
  for (const r of (assignmentsRes.data ?? []) as Array<{ flow: string }>) {
    if (APPROVER_FLOWS.includes(r.flow as ApproverFlow)) {
      const k = r.flow as ApproverFlow;
      flowCounts.set(k, (flowCounts.get(k) ?? 0) + 1);
    }
  }

  const approverFlows = APPROVER_FLOWS.map((flow) => {
    const count = flowCounts.get(flow) ?? 0;
    return {
      flow,
      label: FLOW_LABELS[flow],
      count,
      ok: count >= 2,
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
    lastAdminActivityAt:
      (lastAdminRes.data?.created_at as string | undefined) ?? null,
  };
}

// Duplicated here intentionally — importing from lib/schemas/approvers would
// bloat this aggregator's dep graph, and the labels are short enough.
const FLOW_LABELS: Record<ApproverFlow, string> = {
  'markbook.change_request': 'Markbook · Change requests',
};

const loadSystemHealth = unstable_cache(
  loadSystemHealthUncached,
  ['sis', 'system-health'],
  {
    // This strip is school-wide by design — it takes no ayCode and counts
    // every AY — so there is no AY-coded tag to scope it with. It gets its own
    // dedicated tag instead, and the five write paths that change what the
    // query above selects all emit it:
    //   - sis/ay-setup POST / DELETE — create and remove `academic_years`
    //     rows, which move `ayCount` and can move `currentAy`.
    //   - sis/ay-setup PATCH — flips `academic_years.is_current`, which IS
    //     `currentAy`.
    //   - sis/admin/approvers POST and [id] DELETE — the only writers of
    //     `approver_assignments`, which is the per-flow coverage count.
    //
    // Two things touch this data and deliberately do NOT emit it:
    //   - sis/ay-setup/accepting-applications — writes
    //     `academic_years.accepting_applications`, a column the query above
    //     does not select.
    //   - `lastAdminActivityAt`, the one field read from `audit_log`, CANNOT
    //     be tagged: every admin action in the app appends an audit row, so a
    //     tag covering it would fire on nearly every request and turn this
    //     cache into pure overhead. The 60s TTL is that one field's freshness
    //     contract, and it is the only reason the TTL still matters.
    // Don't close a perceived gap by shotgunning the tag onto either.
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
