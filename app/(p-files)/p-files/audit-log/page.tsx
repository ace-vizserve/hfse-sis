import Link from 'next/link';
import { AlertTriangle, ArrowLeft, FileCheck, ListChecks, Users } from 'lucide-react';
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
import { AuditLogDataTable, type MergedRow } from '@/app/(markbook)/markbook/audit-log/audit-log-data-table';

export default async function PFilesAuditLogPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (sessionUser.role !== 'p-file' && sessionUser.role !== 'admin' && sessionUser.role !== 'superadmin') redirect('/');

  const canExport = sessionUser.role === 'admin' || sessionUser.role === 'superadmin';
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('audit_log')
    .select('id, actor_email, action, entity_type, entity_id, context, created_at')
    .like('action', 'pfile.%')
    .order('created_at', { ascending: false })
    .limit(500);

  const rows: MergedRow[] = ((data ?? []) as Array<{
    id: string;
    actor_email: string;
    action: string;
    entity_type: string;
    entity_id: string | null;
    context: Record<string, unknown>;
    created_at: string;
  }>).map((r) => ({
    id: `new-${r.id}`,
    at: r.created_at,
    actor: r.actor_email,
    action: r.action,
    entity_type: r.entity_type,
    entity_id: r.entity_id,
    context: r.context ?? {},
    sheet_id: null,
    source: 'audit_log' as const,
  }));

  const uniqueActors = new Set(rows.map((r) => r.actor)).size;
  const uploads = rows.filter((r) => r.action === 'pfile.upload').length;

  return (
    <PageShell>
      <Link
        href="/p-files"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Dashboard
      </Link>

      <header className="space-y-4">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          P-Files · Activity
        </p>
        <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
          Audit log.
        </h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          A history of every document upload and replacement. Past entries are kept on the record.
        </p>
      </header>

      {/* Stat cards */}
      <div className="@container/main">
        <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-3">
          <StatCard
            description="Entries loaded"
            value={rows.length.toLocaleString('en-SG')}
            icon={ListChecks}
            footerTitle="Capped at 500 most recent"
            footerDetail="Older entries stay in the database"
          />
          <StatCard
            description="Unique actors"
            value={uniqueActors.toLocaleString('en-SG')}
            icon={Users}
            footerTitle={uniqueActors === 1 ? '1 user' : `${uniqueActors} users`}
            footerDetail="Distinct accounts in this window"
          />
          <StatCard
            description="Uploads"
            value={uploads.toLocaleString('en-SG')}
            icon={FileCheck}
            footerTitle="Staff uploads on behalf"
            footerDetail="Documents uploaded by P-File officers"
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
            <p className="text-sm leading-relaxed text-muted-foreground">{error.message}</p>
          </div>
        </div>
      )}

      <AuditLogDataTable rows={rows} canExport={canExport} />
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
