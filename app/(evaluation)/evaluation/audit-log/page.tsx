import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  ClipboardCheck,
  ListChecks,
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
import {
  AuditLogDataTable,
  type MergedRow,
} from '@/app/(markbook)/markbook/audit-log/audit-log-data-table';

const EVALUATION_AUDIT_ALLOWLIST = [
  'evaluation.writeup.save',
  'evaluation.writeup.submit',
  'evaluation.writeup.resubmit',
  // Virtue themes are edited in this module (Evaluation → Virtue themes); the
  // write originates here even though the action prefix is `ay.*` (the value
  // lives on `terms`). Surface it in the Evaluation audit log.
  'ay.term_virtue.update',
  // Checklist topic CRUD — teacher-owned per section (KD #110)
  'evaluation.checklist_item.create',
  'evaluation.checklist_item.update',
  'evaluation.checklist_item.delete',
  'evaluation.checklist_item.reorder',
  'evaluation.checklist_item.copy_from',
  'evaluation.checklist_response.save',
  'evaluation.subject_comment.save',
  'evaluation.ptc_feedback.save',
] as const;

export default async function EvaluationAuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    pageSize?: string;
    action?: string;
    actor?: string;
  }>;
}) {
  const sessionUser = await getSessionUser();
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
  const params = await searchParams;
  const PAGE_SIZE = Math.min(Number(params.pageSize ?? 50), 200);
  const page = Math.max(Number(params.page ?? 1), 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  // Validate server-side filter params against the allowlist (never let
  // a free-text action value escape through to the DB query).
  const allowlistValues = EVALUATION_AUDIT_ALLOWLIST as readonly string[];
  const currentAction =
    params.action && allowlistValues.includes(params.action)
      ? params.action
      : null;
  const currentActor = params.actor?.trim() || null;

  const supabase = await createClient();

  // Distinct actor query for the Actor select options (un-paginated, scoped
  // to the same allowlist so we only show actors who appear in this module).
  const { data: actorData } = await supabase
    .from('audit_log')
    .select('actor_email')
    .in('action', EVALUATION_AUDIT_ALLOWLIST);
  const actorOptions = Array.from(
    new Set(
      (actorData ?? []).map((r: { actor_email: string }) => r.actor_email)
    )
  ).sort();

  let query = supabase
    .from('audit_log')
    .select(
      'id, actor_email, action, entity_type, entity_id, context, created_at',
      { count: 'exact' }
    )
    .in('action', EVALUATION_AUDIT_ALLOWLIST)
    .order('created_at', { ascending: false });

  if (currentAction) query = query.eq('action', currentAction);
  if (currentActor) query = query.eq('actor_email', currentActor);

  const { data, count, error } = await query.range(from, to);

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
      sheet_id: null,
      source: 'audit_log',
    })
  );

  const uniqueActors = new Set(rows.map((r) => r.actor)).size;
  const writeupSubmits = rows.filter(
    (r) => r.action === 'evaluation.writeup.submit'
  ).length;

  return (
    <PageShell>
      <Link
        href="/evaluation"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Dashboard
      </Link>

      <header className="space-y-4">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Evaluation · Activity
        </p>
        <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
          Audit log.
        </h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          A history of every evaluation action — form-class-adviser write-ups,
          resubmissions, and virtue theme updates. Past entries are kept on the
          record.
        </p>
      </header>

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
            description="Writeups submitted"
            value={writeupSubmits.toLocaleString('en-SG')}
            icon={ClipboardCheck}
            footerTitle={
              writeupSubmits === 0
                ? 'None on this page'
                : 'FCA comments finalised'
            }
            footerDetail="Submitted writeups feed the report card"
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
        canExport={canExport}
        currentAction={currentAction}
        currentActor={currentActor}
        actionOptions={[...EVALUATION_AUDIT_ALLOWLIST]}
        actorOptions={actorOptions}
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
