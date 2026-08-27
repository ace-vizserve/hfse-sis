import { redirect } from 'next/navigation';

import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getStaffDisplayNameById } from '@/lib/auth/staff-list';
import { listDecidedStages, listInboxStages } from '@/lib/approvals/inbox';
import { loadStaffDeclarations } from '@/lib/declarations/staff';
import { DECLARATION_APPROVAL_FLOW } from '@/lib/declarations/approval';
import { PageShell } from '@/components/ui/page-shell';
import {
  DeclarationsQueueTable,
  type DeclarationQueueRow,
} from './declarations-data-table';

// The school's side of a parent-filed absence or travel declaration.
//
// ── PURPOSE (design-system §5, step 1) ─────────────────────────────────────
// A form class adviser opens this to read the declarations parents have filed
// for their classes and decide them. An officer in charge opens it to decide
// the ones that have already passed an adviser. A coordinator opens it to see
// where everything has got to. The primary action is Approve.
//
// ── WHY IT LIVES IN ATTENDANCE ─────────────────────────────────────────────
// The people who act on these are form class advisers, and this is the module
// they already work in — the same module that owns the register the decision
// will eventually write to. It is not an admin screen; it is part of the job.
//
// ⚠ NO ROUTE_ACCESS ROW IS NEEDED and none was added. The broad `/attendance`
// prefix already admits teacher and up, which is exactly this audience. Note
// that ROUTE_ACCESS matches in DECLARATION ORDER, not by prefix length, so a
// row added here would have had to be placed above `/attendance` to have any
// effect at all — not adding one is both correct and the safer move.

export const metadata = { title: 'Declarations · Attendance' };

export default async function DeclarationsQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ req?: string }>;
}) {
  // `?req=` opens one filing straight away — where the notification bell sends
  // somebody who clicked the thing it told them about.
  const { req } = await searchParams;
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  const { role } = sessionUser;
  if (
    role !== 'teacher' &&
    role !== 'academic_coordinator' &&
    role !== 'school_admin' &&
    role !== 'superadmin'
  ) {
    redirect('/');
  }

  const service = createServiceClient();

  // ⚠ ONE scope helper, not a predicate written out here. See
  // lib/approvals/inbox.ts — the other flow's predicate is copy-pasted into six
  // files and three of them already disagree.
  // ⚠ TWO READS, NOT ONE WIDENED READ. "What is waiting for me" and "what
  // happened to the things I was part of" are genuinely different questions —
  // see `listDecidedStages` for the rejection case that makes a single scoped
  // query give the wrong answer to the second one.
  const scope = {
    flow: DECLARATION_APPROVAL_FLOW,
    userId: sessionUser.id,
    role,
  };
  const [stages, decided] = await Promise.all([
    listInboxStages(service, scope),
    listDecidedStages(service, scope),
  ]);
  const allStages = [...stages, ...decided];

  const [declarations, staffNames] = await Promise.all([
    loadStaffDeclarations(
      service,
      allStages.map((s) => s.subjectId)
    ),
    getStaffDisplayNameById(),
  ]);

  const nameById = new Map(staffNames);
  // ⚠ Waiting wins over decided if a subject somehow appears in both. It
  // cannot today — a request is pending or finished, never both — but if it
  // ever did, showing the actionable row is the safe way to be wrong.
  const stageBySubject = new Map([
    ...decided.map((s) => [s.subjectId, s] as const),
    ...stages.map((s) => [s.subjectId, s] as const),
  ]);

  const rows: DeclarationQueueRow[] = declarations
    .map((declaration) => {
      const stage = stageBySubject.get(declaration.id);
      if (!stage) return null;
      const ladder = declaration.ladder;
      return {
        id: declaration.id,
        requestId: stage.requestId,
        studentName: declaration.studentName,
        studentNumber: declaration.studentNumber,
        className: declaration.className,
        declarationType: declaration.declarationType,
        startDate: declaration.startDate,
        endDate: declaration.endDate,
        dayCount: declaration.dayCount,
        withMedical: declaration.withMedical,
        stageLabel: stage.label,
        stageOrder: stage.stageOrder,
        stageCount: ladder?.stages.length ?? stage.stageOrder,
        waitingOn: stage.canDecide ? 'you' : 'someone else',
        canDecide: stage.canDecide,
        // How it ended — 'pending' while it is still moving. This is what the
        // history tab reads, and what stops a finished filing being offered
        // an Approve button.
        outcome: stage.requestStatus,
        // Resolved to a person on the server, like the pools above — a uuid on
        // screen tells nobody anything. Falls back to the email captured at
        // decision time if the account has since been removed.
        decidedByName: stage.decidedBy
          ? (nameById.get(stage.decidedBy) ?? stage.decidedByEmail ?? 'Someone')
          : null,
        decidedAt: stage.decidedAt,
        filedAt: declaration.filedAt,
        detail: declaration,
        // Resolve the frozen uuids to people once, on the server. A pool of
        // ids on screen tells nobody anything.
        peopleByStageOrder: Object.fromEntries(
          (ladder?.stages ?? []).map((s) => [
            s.stageOrder,
            s.approverPool
              .map((id) => nameById.get(id) ?? '(account removed)')
              .join(', '),
          ])
        ),
        decidedByNames: Object.fromEntries(
          (ladder?.stages ?? [])
            .filter((s) => s.decidedBy)
            .map((s) => [
              s.stageOrder,
              nameById.get(s.decidedBy as string) ??
                s.decidedByEmail ??
                'Someone',
            ])
        ),
      } satisfies DeclarationQueueRow;
    })
    .filter((r): r is DeclarationQueueRow => r !== null);

  const forYou = rows.filter((r) => r.canDecide).length;
  const counts = {
    forYou,
    waiting: rows.filter((r) => r.outcome === 'pending').length,
    approved: rows.filter((r) => r.outcome === 'approved').length,
    rejected: rows.filter((r) => r.outcome === 'rejected').length,
  };

  return (
    <PageShell>
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <p className="font-mono text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            Attendance
          </p>
          <h1 className="font-serif text-[38px] leading-[1.05] font-semibold tracking-tight text-foreground md:text-[44px]">
            Declarations.
          </h1>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            When a parent tells the school a child will be away, it arrives
            here. Read what they sent, then approve it or turn it down.
          </p>
        </div>
      </header>

      {/* ⚠ `req` is passed through UNVALIDATED on purpose: it only ever selects
          from `rows`, which is already scoped to what this person may see. A
          request id they have no business with simply matches nothing and the
          page opens as normal. */}
      <DeclarationsQueueTable rows={rows} counts={counts} openRequestId={req} />
    </PageShell>
  );
}
