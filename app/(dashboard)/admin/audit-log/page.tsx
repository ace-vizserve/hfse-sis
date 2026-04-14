import Link from 'next/link';
import { AlertTriangle, ArrowLeft, ListChecks, Lock, Users } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
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

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ sheet_id?: string; action?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  // Fetch both sources in parallel, then merge.
  const [newRes, legacyRes] = await Promise.all([
    supabase
      .from('audit_log')
      .select('id, actor_email, action, entity_type, entity_id, context, created_at')
      .order('created_at', { ascending: false })
      .limit(500),
    supabase
      .from('grade_audit_log')
      .select('*')
      .order('changed_at', { ascending: false })
      .limit(500),
  ]);

  const errors = [newRes.error?.message, legacyRes.error?.message].filter(Boolean);

  type NewRow = {
    id: string;
    actor_email: string;
    action: string;
    entity_type: string;
    entity_id: string | null;
    context: Record<string, unknown>;
    created_at: string;
  };
  type LegacyRow = {
    id: string;
    grading_sheet_id: string;
    grade_entry_id: string;
    field_changed: string;
    old_value: string | null;
    new_value: string | null;
    approval_reference: string | null;
    changed_by: string;
    changed_at: string;
  };

  const merged: MergedRow[] = [
    ...((newRes.data ?? []) as NewRow[]).map(
      (r): MergedRow => ({
        id: `new-${r.id}`,
        at: r.created_at,
        actor: r.actor_email,
        action: r.action,
        entity_type: r.entity_type,
        entity_id: r.entity_id,
        context: r.context ?? {},
        sheet_id:
          (r.context as Record<string, unknown> | null)?.['grading_sheet_id'] as
            | string
            | null
            | undefined ??
          (r.entity_type === 'grading_sheet' ? r.entity_id : null),
        source: 'audit_log',
      }),
    ),
    ...((legacyRes.data ?? []) as LegacyRow[]).map(
      (r): MergedRow => ({
        id: `legacy-${r.id}`,
        at: r.changed_at,
        actor: r.changed_by,
        action:
          r.field_changed.startsWith('ww_totals') ||
          r.field_changed.startsWith('pt_totals') ||
          r.field_changed === 'qa_total'
            ? 'totals.update'
            : 'entry.update',
        entity_type:
          r.field_changed.startsWith('ww_totals') ||
          r.field_changed.startsWith('pt_totals') ||
          r.field_changed === 'qa_total'
            ? 'grading_sheet'
            : 'grade_entry',
        entity_id: r.grade_entry_id,
        context: {
          field: r.field_changed,
          old: r.old_value,
          new: r.new_value,
          was_locked: true,
          approval_reference: r.approval_reference,
          grading_sheet_id: r.grading_sheet_id,
          legacy: true,
        },
        sheet_id: r.grading_sheet_id,
        source: 'grade_audit_log',
      }),
    ),
  ]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 500);

  // Stats compute over the FULL window (not the filtered view) — registrars
  // want a global health snapshot here, not a contextual count.
  const uniqueActors = new Set(merged.map((r) => r.actor)).size;
  const lockedEdits = merged.filter(
    (r) =>
      (r.action === 'entry.update' || r.action === 'totals.update') &&
      r.context['was_locked'] === true,
  ).length;

  return (
    <PageShell>
      <Link
        href="/admin"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Admin
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
            Every mutating action — sheet creation, lock/unlock, score edits (pre- and post-lock),
            totals, student sync, assignments, attendance, comments, report card publications.
            Append-only.
          </p>
        </div>
      </header>

      {/* Stat cards */}
      <div className="@container/main">
        <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-3">
          <StatCard
            description="Entries loaded"
            value={merged.length.toLocaleString('en-SG')}
            icon={ListChecks}
            footerTitle="Capped at 500 most recent"
            footerDetail="Older entries stay in the database, just off-screen"
          />
          <StatCard
            description="Unique actors"
            value={uniqueActors.toLocaleString('en-SG')}
            icon={Users}
            footerTitle={uniqueActors === 1 ? '1 user' : `${uniqueActors} users`}
            footerDetail="Distinct accounts in this window"
          />
          <StatCard
            description="Post-lock edits"
            value={lockedEdits.toLocaleString('en-SG')}
            icon={Lock}
            footerTitle={lockedEdits === 0 ? 'None' : 'Approval-required changes'}
            footerDetail="Edits to locked sheets — should be rare"
          />
        </div>
      </div>

      {errors.length > 0 && (
        <div className="flex items-start gap-4 rounded-xl border border-destructive/30 bg-destructive/5 p-5">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-destructive text-destructive-foreground shadow-brand-tile">
            <AlertTriangle className="size-4" />
          </div>
          <div className="flex-1 space-y-1.5">
            <p className="font-serif text-base font-semibold leading-tight text-foreground">
              Could not load audit entries
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">{errors.join(' · ')}</p>
          </div>
        </div>
      )}

      <AuditLogDataTable
        rows={merged}
        initialSheetIdFilter={params.sheet_id ?? null}
        initialActionFilter={params.action ?? null}
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
