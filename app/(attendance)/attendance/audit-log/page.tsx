import Link from 'next/link';
import { ArrowLeft, History, ListChecks, Users } from 'lucide-react';

import { createClient } from '@/lib/supabase/server';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { PageShell } from '@/components/ui/page-shell';

type AttendanceActionTone = 'default' | 'warn' | 'info';
type AttendanceActionLabel = {
  label: string;
  tone: AttendanceActionTone;
};

const ACTION_LABELS: Record<string, AttendanceActionLabel> = {
  'attendance.daily.update': { label: 'Daily · mark', tone: 'default' },
  'attendance.daily.correct': { label: 'Daily · correction', tone: 'warn' },
  'attendance.import.bulk': { label: 'Bulk import', tone: 'info' },
  'attendance.update': { label: 'Term summary (legacy)', tone: 'info' },
};

// §9.3 wash recipes — brand tokens only. `default` uses the flat muted
// Badge variant (matches the markbook audit log's action chips); `warn`
// + `info` add per-tone wash overrides via Badge variant="outline".
const TONE_CLASS: Record<AttendanceActionTone, string> = {
  default: '',
  warn: 'border-brand-amber/40 bg-brand-amber/15 text-brand-amber',
  info: 'border-brand-indigo-soft/40 bg-accent text-brand-indigo-deep',
};

export default async function AttendanceAuditLogPage() {
  const supabase = await createClient();

  const { data: rows, error } = await supabase
    .from('audit_log')
    .select('id, actor_email, action, entity_type, entity_id, context, created_at')
    .like('action', 'attendance.%')
    .order('created_at', { ascending: false })
    .limit(500);

  type Row = {
    id: string;
    actor_email: string;
    action: string;
    entity_type: string;
    entity_id: string | null;
    context: Record<string, unknown>;
    created_at: string;
  };

  const entries = (rows ?? []) as Row[];
  const uniqueActors = new Set(entries.map((r) => r.actor_email)).size;
  const corrections = entries.filter((r) => r.action === 'attendance.daily.correct').length;

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
            Every attendance mark, correction, and bulk import since this section started. Corrections
            add a new entry rather than overwriting the original — past entries are kept on the record.
          </p>
        </div>
      </header>

      <div className="@container/main">
        <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-3">
          <StatCard
            description="Entries loaded"
            value={entries.length.toLocaleString('en-SG')}
            icon={ListChecks}
            footerTitle="Capped at 500 most recent"
            footerDetail="Older rows stay in the database"
          />
          <StatCard
            description="Unique actors"
            value={uniqueActors.toLocaleString('en-SG')}
            icon={Users}
            footerTitle={uniqueActors === 1 ? '1 user' : `${uniqueActors} users`}
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
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive">
          {error.message}
        </div>
      )}

      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="w-[170px]">When</TableHead>
              <TableHead className="w-[240px]">Actor</TableHead>
              <TableHead className="w-[200px]">Action</TableHead>
              <TableHead>Context</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-12 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <div className="font-serif text-base font-semibold text-foreground">
                      No entries yet
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Once the module starts seeing daily marks or imports, they will appear here.
                    </div>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              entries.map((r) => {
                const label = ACTION_LABELS[r.action] ?? { label: r.action, tone: 'default' as const };
                return (
                  <TableRow key={r.id} className="align-top">
                    <TableCell className="font-mono text-[11px] tabular-nums text-muted-foreground">
                      {new Date(r.created_at).toLocaleString('en-SG', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </TableCell>
                    <TableCell className="text-sm text-foreground">{r.actor_email}</TableCell>
                    <TableCell>
                      {label.tone === 'default' ? (
                        <Badge variant="secondary">{label.label}</Badge>
                      ) : (
                        <Badge variant="outline" className={TONE_CLASS[label.tone]}>
                          {label.label}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <ContextCell context={r.context} />
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
        {entries.length > 0 && (
          <CardContent className="border-t border-border bg-muted/20 px-4 py-2 text-[11px] text-muted-foreground">
            Showing {entries.length.toLocaleString('en-SG')} most recent entries.
          </CardContent>
        )}
      </Card>
    </PageShell>
  );
}

function ContextCell({ context }: { context: Record<string, unknown> }) {
  if (!context || Object.keys(context).length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  // Friendly inline summary for the common action shapes.
  const parts: string[] = [];
  if (typeof context.date === 'string') parts.push(`date: ${context.date}`);
  if (typeof context.status === 'string') parts.push(`status: ${context.status}`);
  if (typeof context.sheet_name === 'string') parts.push(`sheet: ${context.sheet_name}`);
  if (typeof context.section_name === 'string') parts.push(`section: ${context.section_name}`);
  if (typeof context.rows_written === 'number') parts.push(`rows: ${context.rows_written}`);
  if (typeof context.students_matched === 'number') parts.push(`matched: ${context.students_matched}`);
  if (typeof context.students_unmatched === 'number' && context.students_unmatched > 0) {
    parts.push(`unmatched: ${context.students_unmatched}`);
  }
  if (parts.length === 0) {
    return (
      <code className="font-mono text-[11px] text-muted-foreground">
        {JSON.stringify(context)}
      </code>
    );
  }
  return <span className="font-mono text-[11px] text-foreground">{parts.join(' · ')}</span>;
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
