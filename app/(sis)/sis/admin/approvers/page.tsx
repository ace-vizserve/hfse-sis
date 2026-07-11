import { ArrowLeft, Info } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { ApproversDataTable } from '@/components/sis/approvers-data-table';
import { PageShell } from '@/components/ui/page-shell';
import { SisPageHeader } from '@/components/sis/sis-page-header';
import { APPROVER_FLOWS, type ApproverFlow } from '@/lib/schemas/approvers';
import {
  listAllApproverAssignments,
  listEligibleApproverCandidates,
} from '@/lib/sis/approvers/queries';
import { getSessionUser } from '@/lib/supabase/server';

export default async function ApproversPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (sessionUser.role !== 'superadmin') redirect('/sis');

  const [byFlow, candidatesByFlow] = await Promise.all([
    listAllApproverAssignments(),
    Promise.all(
      APPROVER_FLOWS.map(
        async (flow) =>
          [flow, await listEligibleApproverCandidates(flow)] as const
      )
    ).then(
      (entries) =>
        Object.fromEntries(entries) as Record<
          ApproverFlow,
          Array<{ user_id: string; email: string; role: string }>
        >
    ),
  ]);

  return (
    <PageShell>
      <Link
        href="/sis"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Dashboard
      </Link>

      <SisPageHeader
        group="Access & system"
        title="Approver assignments."
        description="Designate which school admins are approvers for each approval flow. When a teacher files a locked-sheet change request, they pick a primary and secondary from the flow’s list; only those two see and act on it."
      />

      <ApproversDataTable byFlow={byFlow} candidatesByFlow={candidatesByFlow} />

      <section className="rounded-xl border border-border bg-muted/30 p-5">
        <div className="mb-3 flex items-center gap-2">
          <Info className="size-4 text-brand-indigo" />
          <p className="font-serif text-[15px] font-semibold text-foreground">
            How this works
          </p>
        </div>
        <ul className="ml-4 list-disc space-y-1.5 text-[13px] leading-relaxed text-muted-foreground">
          <li>
            <strong className="font-medium text-foreground">
              At least 2 approvers per flow
            </strong>{' '}
            — teachers must pick both primary and secondary. Fewer than 2 means
            the request form is blocked with a message telling them to contact
            you.
          </li>
          <li>
            <strong className="font-medium text-foreground">
              First to act wins
            </strong>{' '}
            — primary and secondary both see every request in their inbox and
            can approve or reject independently. There&apos;s no escalation
            timer.
          </li>
          <li>
            <strong className="font-medium text-foreground">
              Revocation is forward-only
            </strong>{' '}
            — removing an approver here does not pull them from in-flight
            requests where they&apos;re already designated. They can still act
            on those until the request is resolved.
          </li>
          <li>
            <strong className="font-medium text-foreground">
              Only school admins are eligible
            </strong>{' '}
            as approvers — superadmins manage this list but don&apos;t approve
            change requests themselves. If you need someone as an approver, set
            their role to{' '}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px]">
              school_admin
            </code>{' '}
            in Supabase Auth first.
          </li>
        </ul>
      </section>
    </PageShell>
  );
}
