'use client';

import * as React from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  CalendarCheck2,
  CheckCircle2,
  Clock,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import Link from 'next/link';

import { SisAdminDrillSheet } from '@/components/sis/drills/sis-admin-drill-sheet';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Sheet } from '@/components/ui/sheet';
import type { SystemHealth } from '@/lib/sis/health';
import type { SisAdminDrillTarget } from '@/lib/sis/drill';

export function SystemHealthStrip({ health }: { health: SystemHealth }) {
  const [drillTarget, setDrillTarget] =
    React.useState<SisAdminDrillTarget | null>(null);
  const { ayCount, currentAy, approverFlows, lastAdminActivityAt } = health;
  const approverIssues = approverFlows.filter((f) => !f.ok).length;
  const overallOk = currentAy != null && approverIssues === 0;

  return (
    <Sheet
      open={!!drillTarget}
      onOpenChange={(o) => !o && setDrillTarget(null)}
    >
      <Card className="overflow-hidden p-0">
        <CardHeader className="border-b border-hairline bg-muted/40 px-6 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                System · Readiness
              </CardDescription>
              <CardTitle className="flex items-center gap-2 font-serif text-lg font-semibold tracking-tight">
                {overallOk ? (
                  <>
                    <CheckCircle2 className="size-4 text-brand-mint" />
                    All systems ready
                  </>
                ) : (
                  <>
                    <ShieldAlert className="size-4 text-destructive" />
                    Needs attention
                  </>
                )}
              </CardTitle>
            </div>
            {lastAdminActivityAt && (
              <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                <Clock className="size-3" />
                Last admin action {formatRelative(lastAdminActivityAt)}
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="grid gap-0 divide-y divide-border md:grid-cols-3 md:divide-x md:divide-y-0 p-0">
          {/* Academic year — click to drill into all AYs */}
          <button
            type="button"
            onClick={() => setDrillTarget('academic-years')}
            className="flex items-start gap-3 p-5 text-left transition-colors hover:bg-muted/40"
          >
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
              <CalendarCheck2 className="size-4" />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Academic year
              </p>
              {currentAy ? (
                <>
                  <p className="font-serif text-base font-semibold text-foreground">
                    {currentAy.ayCode}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {currentAy.label} · {ayCount} total configured
                  </p>
                </>
              ) : (
                <>
                  <p className="font-serif text-base font-semibold text-destructive">
                    No current AY
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Flip{' '}
                    <code className="rounded bg-muted px-1 py-0.5">
                      is_current
                    </code>{' '}
                    in /sis/ay-setup.
                  </p>
                </>
              )}
            </div>
          </button>

          {/* Approver coverage — click to drill into all approver assignments */}
          <button
            type="button"
            onClick={() => setDrillTarget('approver-coverage')}
            className="flex items-start gap-3 p-5 text-left transition-colors hover:bg-muted/40"
          >
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
              {approverIssues === 0 ? (
                <ShieldCheck className="size-4" />
              ) : (
                <ShieldAlert className="size-4" />
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Approvers
              </p>
              <p className="font-serif text-base font-semibold text-foreground">
                {approverFlows.length} flow
                {approverFlows.length === 1 ? '' : 's'}
                {approverIssues > 0 && (
                  <>
                    {' · '}
                    <span className="text-destructive">
                      {approverIssues} under-staffed
                    </span>
                  </>
                )}
              </p>
              <ul className="space-y-0.5 text-xs text-muted-foreground">
                {approverFlows.map((f) => (
                  <li key={f.flow} className="flex items-center gap-1.5">
                    {f.ok ? (
                      <CheckCircle2 className="size-3 text-brand-mint" />
                    ) : (
                      <ShieldAlert className="size-3 text-destructive" />
                    )}
                    <span>
                      <span className="text-foreground">{f.label}:</span>{' '}
                      <span className="tabular-nums">{f.count}</span> assigned
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </button>

          {/* Quick link to approvers */}
          <div className="flex items-center gap-3 p-5">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent text-brand-indigo-deep">
              <ArrowRight className="size-4" />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Manage
              </p>
              <Link
                href="/sis/admin/approvers"
                className="inline-flex items-center gap-1.5 font-serif text-base font-semibold text-foreground hover:text-brand-indigo-deep"
              >
                Approver assignments <ArrowUpRight className="size-3.5" />
              </Link>
              {/* No "AY setup" link here (layout redesign pass, Phase 1) — it
                  duplicated HubYearBand's primary CTA to the same
                  /sis/ay-setup destination; that button is the sole path now. */}
            </div>
          </div>
        </CardContent>
      </Card>
      {drillTarget && <SisAdminDrillSheet target={drillTarget} />}
    </Sheet>
  );
}

function formatRelative(iso: string): string {
  const now = Date.now();
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const diffSec = Math.round((now - t) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(iso).toLocaleDateString('en-SG', {
    month: 'short',
    day: 'numeric',
  });
}
