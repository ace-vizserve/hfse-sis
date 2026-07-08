'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import type { Role } from '@/lib/auth/roles';
import type {
  AyReadiness,
  ReadinessStep,
  ReadinessStepId,
} from '@/lib/sis/readiness';
import {
  AlertTriangle,
  ArrowUpRight,
  CalendarCog,
  CalendarDays,
  CheckCircle2,
  ChevronUp,
  ClipboardCheck,
  LayoutGrid,
  Minus,
  TableProperties,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

type Props = {
  readiness: AyReadiness;
  role: Role | null;
};

const STEP_ICONS: Partial<Record<ReadinessStepId, LucideIcon>> = {
  'ay-setup': CalendarCog,
  calendar: CalendarDays,
  'grading-sheets': TableProperties,
};

export function AyReadinessPill({ readiness, role }: Props) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  if (role !== 'school_admin' && role !== 'superadmin') return null;
  // The Year Setup tab (/sis/ay-setup) renders its own checklist dashboard
  // with the same readiness data — the floating pill there would duplicate
  // (and could visually diverge from) that surface, so it's suppressed here
  // and stays everywhere else, where it still deep-links to /sis/ay-setup.
  if (pathname?.startsWith('/sis/ay-setup')) return null;
  const done = readiness.complete === readiness.total;
  const pct = done
    ? 100
    : Math.round((readiness.complete / readiness.total) * 100);

  return (
    <>
      {/* ── Floating trigger ──────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 shadow-lg transition-all hover:-translate-y-0.5 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-indigo/40"
        aria-label="Open year setup readiness"
      >
        <div
          className={[
            'flex size-10 shrink-0 items-center justify-center rounded-xl text-white',
            done
              ? 'bg-gradient-to-br from-brand-indigo to-brand-navy shadow-brand-tile'
              : 'bg-gradient-to-br from-brand-amber to-brand-amber/80 shadow-brand-tile-amber',
          ].join(' ')}
        >
          <ClipboardCheck className="size-4" />
        </div>
        <div className="text-left">
          <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Year Setup · {readiness.ayCode}
          </p>
          {done ? (
            <p className="mt-0.5 font-serif text-sm font-semibold leading-tight text-brand-mint">
              All steps complete
            </p>
          ) : (
            <>
              <p className="mt-0.5 font-serif text-sm font-semibold leading-tight text-brand-amber">
                Setup needed
              </p>
              <p className="font-mono text-[10px] font-medium tabular-nums text-muted-foreground">
                {readiness.complete} of {readiness.total} steps done
              </p>
            </>
          )}
          <div className="mt-1.5 h-1 w-28 overflow-hidden rounded-full bg-muted">
            <div
              className={[
                'h-full rounded-full transition-all duration-500',
                done
                  ? 'bg-brand-mint'
                  : 'bg-gradient-to-r from-brand-indigo to-brand-mint',
              ].join(' ')}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
        <ChevronUp className="size-4 shrink-0 text-muted-foreground" />
      </button>

      {/* ── Dialog ────────────────────────────────────────────────────── */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl! gap-0 p-0">
          {/* Gradient header */}
          <DialogHeader className="gap-1.5 border-b border-hairline bg-gradient-to-b from-primary/5 to-card px-6 pb-5 pt-6">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              SIS Admin · {readiness.ayCode}
            </p>
            <div className="flex flex-wrap items-center gap-2.5">
              <DialogTitle className="font-serif text-xl font-semibold leading-tight tracking-tight text-foreground">
                Year Setup Readiness
              </DialogTitle>
              <Badge
                variant={
                  readiness.complete === readiness.total ? 'success' : 'warning'
                }
                className="h-6"
              >
                {readiness.complete} / {readiness.total}
              </Badge>
            </div>
            <DialogDescription>
              Steps can be completed in any order.
            </DialogDescription>
          </DialogHeader>

          {/* Step rows */}
          <ScrollArea className="max-h-[60vh]">
            <div className="space-y-2 p-4">
              {readiness.steps.map((step) => (
                <ReadinessRow
                  key={step.id}
                  step={step}
                  icon={STEP_ICONS[step.id] ?? CalendarCog}
                  onNavigate={() => setOpen(false)}
                />
              ))}
            </div>
          </ScrollArea>

          <Separator />

          {/* Footer */}
          <DialogFooter className="justify-between bg-muted/30 px-6 py-3 sm:flex-row sm:justify-between">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {readiness.complete} of {readiness.total} steps complete
            </span>
            <span className="text-[11px] text-muted-foreground">
              Steps can be completed in any order
            </span>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ReadinessRow({
  step,
  icon: Icon,
  onNavigate,
}: {
  step: ReadinessStep;
  icon: LucideIcon;
  onNavigate: () => void;
}) {
  const isDone = step.status === 'done';
  const isPartial = step.status === 'partial';

  const tileClass = isDone
    ? 'bg-gradient-to-br from-brand-mint to-brand-sky shadow-brand-tile-mint'
    : isPartial
      ? 'bg-gradient-to-br from-brand-amber to-brand-amber/80 shadow-brand-tile-amber'
      : 'border border-brand-amber/40 bg-brand-amber-light';

  const pct =
    step.fraction && step.fraction.total > 0
      ? Math.round((step.fraction.done / step.fraction.total) * 100)
      : 0;

  const fractionColor = isDone
    ? 'text-brand-mint'
    : isPartial
      ? 'text-brand-amber'
      : 'text-muted-foreground';
  const barColor = isDone
    ? 'bg-brand-mint'
    : isPartial
      ? 'bg-brand-amber'
      : 'bg-muted-foreground/30';

  return (
    <Card className="gap-0 py-0 shadow-none ring-1 ring-inset ring-border/40">
      <CardContent className="flex items-start gap-3 p-3.5">
        {/* Status icon tile */}
        <div
          className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${tileClass}`}
        >
          {isDone ? (
            <CheckCircle2 className="size-4 text-white" />
          ) : isPartial ? (
            <Icon className="size-4 text-white" />
          ) : (
            <AlertTriangle className="size-4 text-brand-amber" />
          )}
        </div>

        {/* Text content */}
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Step {step.step}
          </p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <CardTitle className="font-serif text-[15px] font-semibold leading-tight tracking-tight text-foreground">
              {step.label}
            </CardTitle>
            <Badge
              variant={isDone ? 'success' : isPartial ? 'warning' : 'secondary'}
              className="h-5"
            >
              {isDone ? (
                <>
                  <CheckCircle2 />
                  Done
                </>
              ) : isPartial ? (
                <>
                  <Minus />
                  In progress
                </>
              ) : (
                'Not started'
              )}
            </Badge>
          </div>

          {/* Coverage fraction bar — Grading Sheets */}
          {step.fraction && step.fraction.total > 0 && (
            <div className="flex items-center gap-2 pt-0.5">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full transition-all ${barColor}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span
                className={`shrink-0 font-mono text-[10px] font-semibold ${fractionColor}`}
              >
                {step.fraction.done}/{step.fraction.total}
              </span>
            </div>
          )}

          <CardDescription className="text-[11px] leading-relaxed">
            {step.description}
          </CardDescription>
        </div>

        {/* Action */}
        <Button
          variant="outline"
          size="sm"
          className="mt-0.5 shrink-0 gap-1"
          asChild
        >
          <Link href="/sis/ay-setup" onClick={onNavigate}>
            Open
            <ArrowUpRight className="size-3.5" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
