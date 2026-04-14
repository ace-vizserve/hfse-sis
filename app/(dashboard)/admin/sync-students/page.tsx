'use client';

import { useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Database,
  FileX,
  Loader2,
  RefreshCw,
  UserMinus,
  UserPlus,
  UserRoundCog,
  Users,
  type LucideIcon,
} from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

type SyncError = {
  row_index: number;
  student_number: string | null;
  reason: string;
};
type LevelBucket = { add: number; update: number; withdraw: number };
type Stats = {
  total_source_rows: number;
  students_to_add: number;
  students_to_update: number;
  enrollments_to_add: number;
  enrollments_to_withdraw: number;
  enrollments_to_reactivate: number;
  errors: number;
  by_level: Record<string, LevelBucket>;
};

type Preview = { ay_code: string; stats: Stats; errors: SyncError[] };

export default function SyncStudentsPage() {
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadPreview() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/students/sync/stats');
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'preview failed');
      setPreview(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown error');
    } finally {
      setLoading(false);
    }
  }

  async function commit() {
    if (!confirm('Apply this sync to the grading database? This cannot be undone.')) return;
    setCommitting(true);
    setError(null);
    try {
      const res = await fetch('/api/students/sync', { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'commit failed');
      const s = body.summary;
      setResult(
        `Synced ${s.enrolled} enrolments (${s.added} new students, ${s.updated} updated, ${s.withdrawn} withdrawn, ${s.reactivated} reactivated).`,
      );
      setPreview(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown error');
    } finally {
      setCommitting(false);
    }
  }

  const stats = preview?.stats;
  const levelRows = stats
    ? Object.entries(stats.by_level).sort(([a], [b]) => a.localeCompare(b))
    : [];

  return (
    <PageShell className="max-w-5xl">
      {/* Hero */}
      <header className="space-y-4">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Administration · Sync
        </p>
        <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
          Sync students from admissions.
        </h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          Preview changes from the admissions database, then commit. Index numbers are
          append-only — existing students keep theirs, and new students get the next available
          index per section.
        </p>
      </header>

      {/* Step 1 — actions */}
      <Card className="@container/card">
        <CardHeader>
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            Step 1 · Preview
          </CardDescription>
          <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
            Dry-run the sync
          </CardTitle>
          <CardAction>
            <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
              <Database className="size-5" />
            </div>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Loads the admissions roster and computes what would change. Nothing is written yet.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={loadPreview} disabled={loading}>
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              {loading ? 'Loading preview…' : preview ? 'Reload preview' : 'Load preview'}
            </Button>
            {preview && (
              <Button onClick={commit} disabled={committing} variant="outline">
                {committing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                {committing ? 'Committing…' : 'Commit sync'}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Sync failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {result && (
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle>Sync complete</AlertTitle>
          <AlertDescription>{result}</AlertDescription>
        </Alert>
      )}

      {stats && (
        <>
          {/* Step 2 — preview stats */}
          <section className="space-y-3">
            <div className="flex items-baseline justify-between">
              <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Step 2 · What will change
              </h2>
              {preview && (
                <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                  {preview.ay_code}
                </span>
              )}
            </div>

            <div className="@container/main">
              <div className="grid grid-cols-2 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-4">
                <StatCard
                  description="Source rows"
                  value={stats.total_source_rows}
                  icon={Database}
                  footer="From admissions DB"
                />
                <StatCard
                  description="New students"
                  value={stats.students_to_add}
                  icon={UserPlus}
                  footer="Added to public.students"
                />
                <StatCard
                  description="Name updates"
                  value={stats.students_to_update}
                  icon={UserRoundCog}
                  footer="Existing rows touched"
                />
                <StatCard
                  description="New enrolments"
                  value={stats.enrollments_to_add}
                  icon={Users}
                  footer="Section × student inserts"
                />
                <StatCard
                  description="Withdrawals"
                  value={stats.enrollments_to_withdraw}
                  icon={UserMinus}
                  footer="Set to withdrawn"
                />
                <StatCard
                  description="Reactivations"
                  value={stats.enrollments_to_reactivate}
                  icon={RefreshCw}
                  footer="Withdrawn → active"
                />
                <StatCard
                  description="Errors"
                  value={stats.errors}
                  icon={FileX}
                  footer={stats.errors > 0 ? 'Rows skipped' : 'None'}
                  tone={stats.errors > 0 ? 'warn' : 'ok'}
                />
              </div>
            </div>
          </section>

          {/* Per-level breakdown */}
          {levelRows.length > 0 && (
            <section className="space-y-3">
              <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                By level
              </h2>
              <Card className="overflow-hidden p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableHead>Level</TableHead>
                      <TableHead className="text-right">Add</TableHead>
                      <TableHead className="text-right">Update</TableHead>
                      <TableHead className="text-right">Withdraw</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {levelRows.map(([label, b]) => (
                      <TableRow key={label}>
                        <TableCell className="font-medium text-foreground">{label}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">{b.add}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {b.update}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {b.withdraw}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            </section>
          )}

          {/* Errors */}
          {preview && preview.errors.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-destructive">
                  {preview.errors.length} row{preview.errors.length === 1 ? '' : 's'} skipped
                </h2>
              </div>
              <Card className="overflow-hidden p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableHead className="w-16">Row</TableHead>
                      <TableHead>Student #</TableHead>
                      <TableHead>Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.errors.map((e, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-mono tabular-nums text-muted-foreground">
                          {e.row_index}
                        </TableCell>
                        <TableCell className="font-mono">
                          {e.student_number ?? (
                            <em className="text-muted-foreground">null</em>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{e.reason}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            </section>
          )}
        </>
      )}
    </PageShell>
  );
}

function StatCard({
  description,
  value,
  icon: Icon,
  footer,
  tone = 'ok',
}: {
  description: string;
  value: number;
  icon: LucideIcon;
  footer: string;
  tone?: 'ok' | 'warn';
}) {
  const warn = tone === 'warn' && value > 0;
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          {description}
        </CardDescription>
        <CardTitle
          className={
            'font-serif text-[28px] font-semibold leading-none tabular-nums @[220px]/card:text-[32px] ' +
            (warn ? 'text-destructive' : 'text-foreground')
          }
        >
          {value.toLocaleString('en-SG')}
        </CardTitle>
        <CardAction>
          <div
            className={
              'flex size-9 items-center justify-center rounded-xl text-white shadow-brand-tile ' +
              (warn
                ? 'bg-gradient-to-br from-destructive to-destructive/70'
                : 'bg-gradient-to-br from-brand-indigo to-brand-navy')
            }
          >
            <Icon className="size-4" />
          </div>
        </CardAction>
      </CardHeader>
      <CardFooter>
        <p className="text-xs text-muted-foreground">{footer}</p>
      </CardFooter>
    </Card>
  );
}
