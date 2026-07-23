import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  History,
  ListChecks,
  Users,
} from 'lucide-react';

import { createClient, getSessionUser } from '@/lib/supabase/server';
import { getStaffDisplayEntries } from '@/lib/auth/staff-list';
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
  AttendanceAuditLogDataTable,
  type AttendanceAuditRow,
} from './audit-log-data-table';

// ---------------------------------------------------------------------------
// Explicit allowlist — every action emitted by the attendance module.
// Uses .in() instead of .like() per KD #9 allowlist discipline.
// ---------------------------------------------------------------------------
export const ATTENDANCE_AUDIT_ACTIONS = [
  'attendance.update',
  'attendance.daily.update',
  'attendance.daily.correct',
  'attendance.import.bulk',
  'attendance.calendar.upsert',
  'attendance.calendar.delete',
  'attendance.calendar.autoseed',
  'attendance.calendar.copy_from_prior_ay',
  'attendance.event.create',
  'attendance.event.update',
  'attendance.event.delete',
] as const satisfies readonly string[];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function AttendanceAuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    pageSize?: string;
    action?: string;
    actor?: string;
    from?: string;
    to?: string;
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

  const params = await searchParams;
  const PAGE_SIZE = Math.min(Number(params.pageSize ?? 50), 200);
  const page = Math.max(Number(params.page ?? 1), 1);
  const rangeFrom = (page - 1) * PAGE_SIZE;
  const rangeTo = rangeFrom + PAGE_SIZE - 1;

  // Validate and extract filter params
  const actionFilter =
    params.action && ATTENDANCE_AUDIT_ACTIONS.includes(params.action as never)
      ? params.action
      : null;
  const actorFilter =
    params.actor && params.actor.trim().length > 0 ? params.actor.trim() : null;
  const fromFilter =
    params.from && DATE_RE.test(params.from) ? params.from : null;
  const toFilter = params.to && DATE_RE.test(params.to) ? params.to : null;

  const supabase = await createClient();

  // Build the main query with server-side filters
  let q = supabase
    .from('audit_log')
    .select(
      'id, actor_email, action, entity_type, entity_id, context, created_at',
      { count: 'exact' }
    )
    .in('action', ATTENDANCE_AUDIT_ACTIONS);

  if (actionFilter) q = q.eq('action', actionFilter);
  if (actorFilter) q = q.ilike('actor_email', `%${actorFilter}%`);
  if (fromFilter) q = q.gte('created_at', fromFilter);
  if (toFilter) q = q.lte('created_at', `${toFilter}T23:59:59.999Z`);

  const [{ data: rows, count, error }, staffEntries, actorEmailsResult] =
    await Promise.all([
      q.order('created_at', { ascending: false }).range(rangeFrom, rangeTo),
      getStaffDisplayEntries(),
      // Fetch distinct actor emails for the dropdown (scoped to allowlist)
      supabase
        .from('audit_log')
        .select('actor_email')
        .in('action', ATTENDANCE_AUDIT_ACTIONS)
        .order('actor_email')
        .limit(200),
    ]);

  // Dedupe actor emails
  const actorOptions = Array.from(
    new Set(
      (actorEmailsResult.data ?? [])
        .map((r: { actor_email: string }) => r.actor_email)
        .filter(Boolean)
    )
  ).sort();

  const totalPages = count ? Math.ceil(count / PAGE_SIZE) : 1;

  type RawRow = {
    id: string;
    actor_email: string;
    action: string;
    entity_type: string;
    entity_id: string | null;
    context: Record<string, unknown>;
    created_at: string;
  };

  const rawEntries = (rows ?? []) as RawRow[];
  const actorMap = new Map<string, string>(staffEntries);

  const entries: AttendanceAuditRow[] = rawEntries.map((r) => ({
    id: r.id,
    at: r.created_at,
    actor_email: r.actor_email,
    actor_display: actorMap.get(r.actor_email) ?? r.actor_email,
    action: r.action,
    entity_type: r.entity_type,
    entity_id: r.entity_id,
    context: r.context ?? {},
  }));

  const uniqueActors = new Set(entries.map((r) => r.actor_email)).size;
  const corrections = entries.filter(
    (r) => r.action === 'attendance.daily.correct'
  ).length;

  return (
    <PageShell>
      <Link
        href="/attendance"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Attendance
      </Link>

      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Attendance · Audit log
          </p>
          <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
            Daily-attendance history.
          </h1>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            Every attendance mark, correction, and bulk import since this
            section started. Corrections add a new entry rather than overwriting
            the original — past entries are kept on the record.
          </p>
        </div>
      </header>

      <div className="@container/main">
        <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-3">
          <StatCard
            description="Entries loaded"
            value={entries.length.toLocaleString('en-SG')}
            icon={ListChecks}
            footerTitle={
              count != null
                ? `${count.toLocaleString('en-SG')} total entries`
                : `${entries.length.toLocaleString('en-SG')} entries`
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
            description="Corrections"
            value={corrections.toLocaleString('en-SG')}
            icon={History}
            footerTitle={corrections === 0 ? 'None' : 'Historical edits'}
            footerDetail="Back-dated attendance fixes"
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

      <AttendanceAuditLogDataTable
        rows={entries}
        pagination={{
          page,
          pageSize: PAGE_SIZE,
          totalPages,
          total: count ?? 0,
        }}
        actionOptions={[...ATTENDANCE_AUDIT_ACTIONS]}
        actorOptions={actorOptions}
        currentAction={actionFilter}
        currentActor={actorFilter}
        currentFrom={fromFilter}
        currentTo={toFilter}
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
