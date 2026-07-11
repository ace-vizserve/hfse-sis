import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { ApproversDataTable } from '@/components/sis/approvers-data-table';
import { PageShell } from '@/components/ui/page-shell';
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

      <header className="space-y-3">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          SIS Admin · Access
        </p>
        <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
          Approver assignments.
        </h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          Designate which school admins are approvers for each approval flow.
          When a teacher files a locked-sheet change request, they pick a
          primary + secondary from the flow&apos;s list; only those two see and
          act on it.
        </p>
      </header>

      <ApproversDataTable byFlow={byFlow} candidatesByFlow={candidatesByFlow} />

      <section className="rounded-xl border border-hairline bg-card p-4 text-xs leading-relaxed text-muted-foreground">
        <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-indigo-deep">
          How this works
        </p>
        <ul className="ml-4 list-disc space-y-1">
          <li>
            <strong>At least 2 approvers per flow</strong> — teachers must pick
            both primary and secondary. Fewer than 2 = the request form is
            blocked with a message telling them to contact you.
          </li>
          <li>
            <strong>First to act wins</strong> — primary and secondary both see
            every request in their inbox and can approve/reject independently.
            There&apos;s no escalation timer.
          </li>
          <li>
            <strong>Revocation is forward-only</strong> — removing an approver
            here does NOT pull them from in-flight requests where they&apos;re
            already designated. They can still act on those until the request is
            resolved.
          </li>
          <li>
            <strong>Only school admins are eligible</strong> as approvers —
            superadmins manage this list but don&apos;t approve change requests
            themselves. If you need someone as an approver, set their role to{' '}
            <code className="rounded bg-muted px-1 py-0.5">school_admin</code>{' '}
            in Supabase Auth first.
          </li>
        </ul>
      </section>
    </PageShell>
  );
}
