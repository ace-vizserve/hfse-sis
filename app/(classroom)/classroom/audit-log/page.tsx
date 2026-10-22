import Link from 'next/link';
import {
  AlertTriangle,
  ArrowLeft,
  Gavel,
  NotebookPen,
  ListChecks,
  Users,
} from 'lucide-react';
import { createClient, getSessionUser } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { loadAuditActorEmails } from '@/lib/audit/actor-emails';
import { parseAuditFilters, applyAuditFilters } from '@/lib/audit/filters';
import { auditRowLink } from '@/lib/audit/row-links';
import {
  AuditLogDataTable,
  type MergedRow,
} from '@/components/audit/audit-log-data-table';

// Classroom → Audit log: class notes saved and discipline records filed or
// updated, with who did it and when. Office roles only, as Discipline is
// (teachers read discipline, they do not file it).
export default async function ClassroomAuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    pageSize?: string;
    action?: string;
    actor?: string;
    from?: string;
    to?: string;
    q?: string;
  }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (
    sessionUser.role !== 'academic_coordinator' &&
    sessionUser.role !== 'school_admin' &&
    sessionUser.role !== 'superadmin'
  )
    redirect('/');

  const canExport =
    sessionUser.role === 'school_admin' || sessionUser.role === 'superadmin';
  const params = await searchParams;
  const PAGE_SIZE = Math.min(Number(params.pageSize ?? 50), 200);
  const page = Math.max(Number(params.page ?? 1), 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  const supabase = await createClient();

  const CLASSROOM_AUDIT_ALLOWLIST = [
    'classroom.note.save',
    'discipline.record.file',
    'discipline.record.update',
  ] as const;

  const filters = parseAuditFilters(params, CLASSROOM_AUDIT_ALLOWLIST);

  const [actorOptions, logResult] = await Promise.all([
    loadAuditActorEmails(supabase, CLASSROOM_AUDIT_ALLOWLIST, 'classroom'),
    applyAuditFilters(
      supabase
        .from('audit_log')
        .select(
          'id, actor_email, actor_role, action, entity_type, entity_id, context, created_at',
          { count: 'exact' }
        )
        .in('action', CLASSROOM_AUDIT_ALLOWLIST),
      filters
    )
      .order('created_at', { ascending: false })
      .range(from, to),
  ]);
  const { data, count, error } = logResult;

  const totalPages = count ? Math.ceil(count / PAGE_SIZE) : 1;

  const rows: MergedRow[] = (
    (data ?? []) as Array<{
      id: string;
      actor_email: string;
      actor_role: string | null;
      action: string;
      entity_type: string;
      entity_id: string | null;
      context: Record<string, unknown>;
      created_at: string;
    }>
  ).map((r) => ({
    id: `new-${r.id}`,
    at: r.created_at,
    actor: r.actor_email,
    actorRole: r.actor_role,
    action: r.action,
    entity_type: r.entity_type,
    entity_id: r.entity_id,
    context: r.context ?? {},
    sheet_id: null,
    source: 'audit_log' as const,
    link: auditRowLink(r, sessionUser.role),
  }));

  const uniqueActors = new Set(rows.map((r) => r.actor)).size;
  const notes = rows.filter((r) => r.action === 'classroom.note.save').length;
  const discipline = rows.length - notes;

  return (
    <PageShell>
      <Link
        href="/classroom"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        All classes
      </Link>

      <header className="space-y-4">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Classroom · Activity
        </p>
        <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
          Audit log.
        </h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          Every class note saved and every discipline record filed or updated,
          with who did it and when. Past entries are kept on the record.
        </p>
      </header>

      {/* Stat cards */}
      <div className="@container/main">
        <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-2 xl/main:grid-cols-4">
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
            footerDetail="Distinct accounts in this window"
          />
          <StatCard
            description="Class notes"
            value={notes.toLocaleString('en-SG')}
            icon={NotebookPen}
            footerTitle="Notes saved on this page"
            footerDetail="Class notes written by teaching staff"
          />
          <StatCard
            description="Discipline"
            value={discipline.toLocaleString('en-SG')}
            icon={Gavel}
            footerTitle="Records filed or updated on this page"
            footerDetail="Discipline records"
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
        currentAction={filters.action}
        currentActor={filters.actor}
        currentFrom={filters.from}
        currentTo={filters.to}
        currentSearch={filters.search}
        actionOptions={[...CLASSROOM_AUDIT_ALLOWLIST]}
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
