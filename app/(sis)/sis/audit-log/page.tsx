import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  ListChecks,
  Settings2,
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

// Config-axis actions owned by SIS Admin. Student-record-axis actions
// (sis.profile.update, student.section.transfer, ay.*, pfile.*, etc.)
// live on /records/audit-log — this page covers the structural admin tier.
// user.login + parent.session.* included here for session-issuance visibility.
const SIS_AUDIT_ALLOWLIST = [
  // Approver assignments (KD #41)
  'approver.assign',
  'approver.revoke',
  // Subject catalog (KD #72)
  'subject.create',
  'subject_config.update',
  // Master class template (KD #66, #72)
  'template.section.create',
  'template.section.update',
  'template.section.delete',
  'template.subject_config.create',
  'template.subject_config.update',
  'template.subject_config.delete',
  'template.subject_config.bulk_delete',
  'template.apply',
  // Sections + teacher assignments
  'section.create',
  'section.rename',
  'section.realphabetize',
  'assignment.create',
  'assignment.delete',
  // Grade levels & progression (migration 078)
  'level.create',
  'level.update',
  'level.delete',
  'level.offering.toggle',
  // School calendar (/sis/calendar) — full trail incl. events + auto-seed
  'attendance.calendar.upsert',
  'attendance.calendar.delete',
  'attendance.calendar.autoseed',
  'attendance.calendar.copy_from_prior_ay',
  'attendance.event.create',
  'attendance.event.update',
  'attendance.event.delete',
  // Term dates / virtue / grading lock (/sis/ay-setup)
  'ay.term_dates.update',
  'ay.term_virtue.update',
  'ay.term_grading_lock.update',
  // School config
  'school_config.update',
  // User provisioning (KD #87)
  'user.invite',
  'user.create',
  'user.role.update',
  'user.disable',
  'user.enable',
  // Environment + seeder (KD #52)
  'environment.switch',
  'environment.seed',
  'environment.topup',
  // Session issuance (Phase 7 — visibility for security review)
  'user.login',
  'parent.session.issued',
  'parent.session.cleared',
] as const;

export default async function SisAuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; pageSize?: string }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (
    sessionUser.role !== 'school_admin' &&
    sessionUser.role !== 'superadmin'
  ) {
    redirect('/');
  }

  const params = await searchParams;
  const PAGE_SIZE = Math.min(Number(params.pageSize ?? 50), 200);
  const page = Math.max(Number(params.page ?? 1), 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const supabase = await createClient();

  const { data, count, error } = await supabase
    .from('audit_log')
    .select(
      'id, actor_email, action, entity_type, entity_id, context, created_at',
      { count: 'exact' }
    )
    .in('action', SIS_AUDIT_ALLOWLIST)
    .order('created_at', { ascending: false })
    .range(from, to);

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
  const configChanges = rows.filter(
    (r) =>
      r.action === 'school_config.update' ||
      r.action === 'template.apply' ||
      r.action === 'environment.switch'
  ).length;

  return (
    <PageShell>
      <Link
        href="/sis"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Admin Hub
      </Link>

      <header className="space-y-4">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          SIS Admin · Activity
        </p>
        <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
          Audit log.
        </h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          A history of every administrative change — sections created, teachers
          assigned, templates applied, approvers managed, school config edited,
          users added, and environment operations. Past entries are kept on the
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
            description="Config changes"
            value={configChanges.toLocaleString('en-SG')}
            icon={Settings2}
            footerTitle={
              configChanges === 0
                ? 'None on this page'
                : 'High-impact operations'
            }
            footerDetail="School config, template applies, env switches"
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
        canExport={sessionUser.role === 'superadmin'}
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
