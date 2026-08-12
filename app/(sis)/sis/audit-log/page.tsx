import { redirect } from 'next/navigation';
import { AlertTriangle, ListChecks, Settings2, Users } from 'lucide-react';

import { HubStat } from '@/components/sis/hub-stat';
import { type DashboardSearchParams } from '@/lib/dashboard/range';
import { createClient, getSessionUser } from '@/lib/supabase/server';
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
  'subject_config.create',
  'subject_config.update',
  'subject_level_offering.toggle',
  'subject_report_map.update',
  'subject.catalog.update',
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
  'section.delete',
  'section.realphabetize',
  'section.index.generate',
  'section.track.assign',
  'section.schedule.update',
  'section.subject.assign',
  'section.subject.remove',
  'section.subjects.load_defaults',
  'section.subjects.attach_many',
  'assignment.create',
  'assignment.delete',
  // Cover for an absent teacher (migration 112). Sits with the assignment
  // actions because it is read the same way — "who is on this class, and since
  // when" — and because a relief starting is often the next line after the
  // reason a teacher stepped away.
  'assignment.relief.start',
  'assignment.relief.end',
  // Grade levels & progression (migration 078) — the admin page + write
  // routes were removed by migration 086; kept in this allowlist so
  // historical rows stay visible (Hard Rule #6, append-only). sis.level.create
  // is the same removed feature's later action name (was missed when this
  // cluster was first written — audit-log-coverage sweep, 2026-07-24).
  'level.create',
  'level.update',
  'level.delete',
  'level.offering.toggle',
  'sis.level.create',
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
  'user.info.update',
  'user.role.update',
  'role.permissions.update',
  'user.disable',
  'user.enable',
  'user.delete',
  // Environment + seeder (KD #52) — feature removed once the test AYs were
  // gone from the database; kept so historical rows still show up here.
  'environment.switch',
  'environment.seed',
  'environment.topup',
  'environment.demo_accounts_removed',
  // Session issuance (Phase 7 — visibility for security review)
  'user.login',
  'parent.session.issued',
  'parent.session.cleared',
] as const;

type SisAuditLogSearchParams = DashboardSearchParams & {
  view?: string;
  page?: string;
  pageSize?: string;
  actor?: string;
};

// The Log cut — the paginated, allowlisted table. Session and role are guarded
// by the layout, which runs for this route and everything beneath it.
export default async function SisAuditLogPage({
  searchParams,
}: {
  searchParams: Promise<SisAuditLogSearchParams>;
}) {
  // The layout already guarantees a session and the right role. Re-read here
  // only because CSV export is superadmin-only and the check narrows the type.
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');

  const params = await searchParams;

  // Overview used to live here as `?view=overview`. That URL was linkable and
  // may be bookmarked, so it keeps working.
  if (params.view === 'overview') redirect('/sis/audit-log/overview');

  const logView = await (async () => {
    const PAGE_SIZE = Math.min(Number(params.pageSize ?? 50), 200);
    const page = Math.max(Number(params.page ?? 1), 1);
    const from = (page - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    const actorFilter = params.actor?.trim();

    const supabase = await createClient();

    let q = supabase
      .from('audit_log')
      .select(
        'id, actor_email, action, entity_type, entity_id, context, created_at',
        { count: 'exact' }
      )
      .in('action', SIS_AUDIT_ALLOWLIST);

    if (actorFilter) q = q.eq('actor_email', actorFilter);

    const { data, count, error } = await q
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

    return {
      rows,
      count,
      error,
      page,
      pageSize: PAGE_SIZE,
      totalPages,
      uniqueActors,
      configChanges,
    };
  })();

  return (
    <>
      {/* HubStat here (vs. MetricCard on Overview) is a deliberate,
              documented split, not a silent inconsistency: this is a live
              paginated-page glance with no delta/comparison need, the exact
              case HubStat was built for; Overview's KPIs carry a real
              period-over-period delta chip, which only MetricCard supports. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <HubStat
          label="Entries loaded"
          value={logView.rows.length}
          icon={ListChecks}
          tone="brand"
          subtext={
            logView.count != null
              ? `${logView.count.toLocaleString('en-SG')} total · page ${logView.page}/${logView.totalPages}`
              : `Page ${logView.page} of ${logView.totalPages}`
          }
        />
        <HubStat
          label="Unique actors"
          value={logView.uniqueActors}
          icon={Users}
          tone="sky"
          subtext="Distinct accounts on this page"
        />
        <HubStat
          label="Config changes"
          value={logView.configChanges}
          icon={Settings2}
          tone={logView.configChanges > 0 ? 'amber' : 'muted'}
          subtext="School config, template applies, env switches"
        />
      </div>

      {logView.error && (
        <div className="flex items-start gap-4 rounded-xl border border-destructive/30 bg-destructive/5 p-5">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-destructive text-destructive-foreground shadow-brand-tile">
            <AlertTriangle className="size-4" />
          </div>
          <div className="flex-1 space-y-1.5">
            <p className="font-serif text-base font-semibold leading-tight text-foreground">
              Could not load audit entries
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {logView.error.message}
            </p>
          </div>
        </div>
      )}

      <AuditLogDataTable
        rows={logView.rows}
        canExport={sessionUser.role === 'superadmin'}
        pagination={{
          page: logView.page,
          pageSize: logView.pageSize,
          totalPages: logView.totalPages,
          total: logView.count ?? 0,
        }}
      />
    </>
  );
}
