import { Info } from 'lucide-react';
import { redirect } from 'next/navigation';

import { PageShell } from '@/components/ui/page-shell';
import { SisPageHeader } from '@/components/sis/sis-page-header';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import {
  listLevelTypesInUse,
  loadAllFlowConfigs,
} from '@/lib/approvals/config';
import { listStaffUsers } from '@/lib/sis/users/queries';
import { StagedFlowEditor } from '@/components/sis/staged-flow-editor';

// /sis/admin/approvers — who approves what, and in what order.
//
// ── PURPOSE (design-system §5, step 1) ─────────────────────────────────────
// A superadmin sets out, for each kind of request, the steps it goes through
// and who is on each step. The primary action is adding a step or a person.
//
// ── PATTERN ────────────────────────────────────────────────────────────────
// Header, one short panel of rules, then one §8 group container card per kind
// of request (`StagedFlowEditor`).
//
// ⚠ THE TWO-APPROVER POOL IS GONE FROM THIS SCREEN. Grade change requests used
// to have a teacher pick a primary and a secondary from `approver_assignments`;
// they now go through ordered steps like everything else (KD #196), so the
// readiness cards, the pool table and their "at least 2 approvers" rules were
// removed rather than left beside a mechanism that no longer reads them.
//
// ⚠ The rules panel is above the cards on purpose (Law of Proximity): it is
// what a superadmin needs to know BEFORE adding or removing somebody, not
// something to discover after scrolling past the steps.

const RULES: Array<{ lead: string; body: string }> = [
  {
    lead: 'Steps happen in order',
    body: 'A request goes to the first step, and only moves on once that step is approved.',
  },
  {
    // ⚠ Was "Whoever acts first moves it on", which stopped being true of
    // every step when a step could need everyone on it (migration 145).
    lead: 'One of them, or all of them',
    body: 'A step can have one person or several. Each step says whether any one of them is enough, or everyone on it must approve.',
  },
  {
    lead: 'A “no” at any step ends it',
    body: 'Later steps never see a request that has been turned down, and whoever filed it is told.',
  },
  {
    lead: 'Nobody picks their approver',
    body: 'Parents and teachers who file a request never choose who approves it. It follows the steps set here.',
  },
];

export default async function ApproversPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (sessionUser.role !== 'superadmin') redirect('/sis');

  const service = createServiceClient();

  const [stagedFlows, staff, levelTypesInUse] = await Promise.all([
    loadAllFlowConfigs(service),
    listStaffUsers(),
    listLevelTypesInUse(service),
  ]);

  return (
    <PageShell>
      <SisPageHeader
        group="Access & system"
        title="Approvers."
        description="Every approval in the school is a list of steps, taken in order. Set out the steps for each kind of request, and who is on each step."
      />

      <section
        aria-labelledby="approval-rules-heading"
        className="rounded-xl border border-border bg-muted/30 p-5"
      >
        <div className="mb-4 flex items-center gap-2">
          <Info className="size-4 text-brand-indigo" aria-hidden />
          <h2
            id="approval-rules-heading"
            className="font-serif text-[15px] font-semibold text-foreground"
          >
            How approvals work
          </h2>
        </div>
        <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
          {RULES.map((rule) => (
            <div key={rule.lead} className="space-y-1">
              <dt className="text-[13px] font-medium text-foreground">
                {rule.lead}
              </dt>
              <dd className="text-[13px] leading-relaxed text-muted-foreground">
                {rule.body}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <StagedFlowEditor
        flows={stagedFlows}
        staff={staff
          .filter((u) => !u.disabled)
          .map((u) => ({
            userId: u.id,
            email: u.email,
            displayName: u.display_name,
            role: u.role,
          }))}
        levelTypesInUse={levelTypesInUse}
      />
    </PageShell>
  );
}
