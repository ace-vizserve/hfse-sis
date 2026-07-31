import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  ListChecks,
  Lock,
  Users,
} from 'lucide-react';
import { createClient, getSessionUser } from '@/lib/supabase/server';
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { AuditLogDataTable, type MergedRow } from './audit-log-data-table';

// Explicit allowlist — every action emitted by the markbook module.
// Positive filter prevents non-markbook prefixes from leaking in
// (the prior negative filter only excluded pfile.* and sis.*).
// grade_audit_log (pre-migration-006 rows) is no longer unioned here;
// the table stays in Postgres but is off-screen (Hard Rule #6).
// Exported so the data-table can build its Action Select options.
export const MARKBOOK_AUDIT_ALLOWLIST = [
  'sheet.create',
  'sheet.bulk_create',
  'sheet.lock',
  'sheet.unlock',
  'sheet.unlock_force_with_pending_crs',
  'sheet.unlock_force_deadline_passed',
  'sheet.lock_overdue_batch',
  'sheet.labels.update',
  'entry.update',
  'totals.update',
  'comment.update',
  'publication.create',
  'publication.delete',
  'grade_change_requested',
  'grade_change_approved',
  'grade_change_rejected',
  'grade_change_cancelled',
  'grade_change_applied',
  'grade_change_undo_rejection',
  'grade_correction',
  'grade_entry.annual_letter.update',
  // Classroom (Phase 6, KD-pending) has no /audit-log page of its own — the
  // module's own audit surface is the per-class Timeline sub-route
  // (lib/classroom/timeline.ts), which reads audit_log directly by
  // entity_id rather than through an allowlist. This entry exists solely so
  // `classroom.note.save` is visible on at least one module page, per
  // __tests__/audit/allowlist-coverage.test.ts. Markbook is the closest
  // fit — the Classroom class page is explicitly modelled as an evolution
  // of the Markbook section-detail page (design spec §Reuse).
  'classroom.note.save',
] as const;

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{
    sheet_id?: string;
    action?: string;
    actor?: string;
    page?: string;
    pageSize?: string;
  }>;
}) {
  const params = await searchParams;
  const sessionUser = await getSessionUser();
  // This page had no role guard of its own until KD #173 — the sole Markbook
  // page without one (insights, sections, change-requests and grading/new all
  // defend themselves). Both ROUTE_ACCESS `/markbook` and the route-group
  // layout admit `teacher`, so a teacher who typed this URL rendered the whole
  // shell; only the `audit_log_registrar_read` RLS policy (migration 006) kept
  // the table empty, which is defence in depth by accident rather than by
  // design. The nav has never offered this page to a teacher, so what this
  // closes is a typed-URL hole, not a broken link. Matches the sibling guard on
  // /records/audit-log exactly.
  if (!sessionUser) redirect('/login');
  if (
    sessionUser.role !== 'academic_coordinator' &&
    sessionUser.role !== 'school_admin' &&
    sessionUser.role !== 'superadmin'
  ) {
    redirect('/');
  }

  const canExport =
    sessionUser.role === 'school_admin' || sessionUser.role === 'superadmin';
  const supabase = await createClient();

  const PAGE_SIZE = Math.min(Number(params.pageSize ?? 50), 200);
  const page = Math.max(Number(params.page ?? 1), 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  // Validate action filter against allowlist to prevent injection
  const actionFilter =
    params.action &&
    (MARKBOOK_AUDIT_ALLOWLIST as readonly string[]).includes(params.action)
      ? params.action
      : null;
  const actorFilter =
    params.actor && params.actor.trim().length > 0 ? params.actor.trim() : null;

  let q = supabase
    .from('audit_log')
    .select(
      'id, actor_email, action, entity_type, entity_id, context, created_at',
      { count: 'exact' }
    )
    .in('action', MARKBOOK_AUDIT_ALLOWLIST);

  if (actionFilter) q = q.eq('action', actionFilter);
  if (actorFilter) q = q.eq('actor_email', actorFilter);
  if (params.sheet_id)
    q = q.contains('context', { grading_sheet_id: params.sheet_id });

  const [{ data, count, error }, actorEmailsResult] = await Promise.all([
    q.order('created_at', { ascending: false }).range(from, to),
    // Fetch distinct actor emails across the whole allowlist (unfiltered by page)
    supabase
      .from('audit_log')
      .select('actor_email')
      .in('action', MARKBOOK_AUDIT_ALLOWLIST)
      .order('actor_email')
      .limit(200),
  ]);

  const actorOptions = Array.from(
    new Set(
      (actorEmailsResult.data ?? [])
        .map((r: { actor_email: string }) => r.actor_email)
        .filter(Boolean)
    )
  ).sort();

  const totalPages = count ? Math.ceil(count / PAGE_SIZE) : 1;

  const rows: MergedRow[] = (
    (data ?? []) as Array<{
      id: string;
      actor_email: string;
      action: string;
      entity_type: string;
      entity_id: string | null;
      context: Record<string, unknown>;
      created_at: string;
    }>
  ).map(
    (r): MergedRow => ({
      id: `new-${r.id}`,
      at: r.created_at,
      actor: r.actor_email,
      action: r.action,
      entity_type: r.entity_type,
      entity_id: r.entity_id,
      context: r.context ?? {},
      sheet_id:
        ((r.context as Record<string, unknown> | null)?.['grading_sheet_id'] as
          | string
          | null
          | undefined) ??
        (r.entity_type === 'grading_sheet' ? r.entity_id : null),
      source: 'audit_log',
    })
  );

  const uniqueActors = new Set(rows.map((r) => r.actor)).size;
  const lockedEdits = rows.filter(
    (r) =>
      (r.action === 'entry.update' || r.action === 'totals.update') &&
      r.context['was_locked'] === true
  ).length;

  return (
    <PageShell>
      <Link
        href="/markbook"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Markbook
      </Link>

      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Administration · Audit log
          </p>
          <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
            Audit log.
          </h1>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            A history of every grading change — sheet creation, locks and
            unlocks, score edits, totals, change requests, and report card
            publications. Past entries are kept on the record.
          </p>
        </div>
      </header>

      {/* Stat cards */}
      <div className="@container/main">
        <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-3">
          <StatCard
            description="Entries loaded"
            value={rows.length.toLocaleString('en-SG')}
            icon={ListChecks}
            footerTitle={
              count != null
                ? `${count.toLocaleString('en-SG')} total entries`
                : `${rows.length.toLocaleString('en-SG')} entries`
            }
            footerDetail={`Page ${page} of ${totalPages} · ${PAGE_SIZE} per page`}
          />
          <StatCard
            description="Unique actors"
            value={uniqueActors.toLocaleString('en-SG')}
            icon={Users}
            footerTitle={
              uniqueActors === 1 ? '1 user' : `${uniqueActors} users`
            }
            footerDetail="Distinct accounts on this page"
          />
          <StatCard
            description="Post-lock edits"
            value={lockedEdits.toLocaleString('en-SG')}
            icon={Lock}
            footerTitle={
              lockedEdits === 0 ? 'None' : 'Approval-required changes'
            }
            footerDetail="Edits to locked sheets — should be rare"
          />
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-4 rounded-xl border border-destructive/30 bg-destructive/5 p-5">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-destructive text-destructive-foreground shadow-brand-tile">
            <AlertTriangle className="size-4" />
          </div>
          <div className="flex-1 space-y-1.5">
            <p className="font-serif text-base font-semibold leading-tight text-foreground">
              Could not load audit entries
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {error.message}
            </p>
          </div>
        </div>
      )}

      <AuditLogDataTable
        rows={rows}
        initialSheetIdFilter={params.sheet_id ?? null}
        currentAction={actionFilter}
        currentActor={actorFilter}
        actionOptions={[...MARKBOOK_AUDIT_ALLOWLIST]}
        actorOptions={actorOptions}
        canExport={canExport}
        pagination={{
          page,
          pageSize: PAGE_SIZE,
          totalPages,
          total: count ?? 0,
        }}
      />
    </PageShell>
  );
}

function StatCard({
  description,
  value,
  icon: Icon,
  footerTitle,
  footerDetail,
}: {
  description: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  footerTitle: string;
  footerDetail: string;
}) {
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          {description}
        </CardDescription>
        <CardTitle className="font-serif text-[28px] font-semibold leading-none tabular-nums text-foreground @[240px]/card:text-[34px]">
          {value}
        </CardTitle>
        <CardAction>
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <Icon className="size-4" />
          </div>
        </CardAction>
      </CardHeader>
      <CardFooter className="flex-col items-start gap-1 text-sm">
        <p className="font-medium text-foreground">{footerTitle}</p>
        <p className="text-xs text-muted-foreground">{footerDetail}</p>
      </CardFooter>
    </Card>
  );
}
