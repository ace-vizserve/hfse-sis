// components/sis/hub-readiness-popover.tsx
'use client';

import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import {
  groupStepsForPopover,
  ringPercent,
  stepBadgeLabel,
} from '@/lib/sis/hub-readiness-summary';
import type {
  AyReadiness,
  ReadinessStatus,
  ReadinessStep,
} from '@/lib/sis/readiness';

const RING_COLOR: Record<ReadinessStatus, string> = {
  done: 'var(--color-brand-mint)',
  partial: 'var(--color-brand-amber)',
  not_started: 'var(--color-muted-foreground)',
};

const BADGE_CLASS: Record<ReadinessStatus, string> = {
  done: 'bg-brand-mint/20 text-ink',
  partial: 'bg-brand-amber/20 text-ink',
  not_started: 'bg-muted text-muted-foreground',
};

function StepRing({ step }: { step: ReadinessStep }) {
  const pct = ringPercent(step);
  const color = RING_COLOR[step.status];
  return (
    <div
      className="relative flex size-11 shrink-0 items-center justify-center rounded-full"
      style={{
        background: `conic-gradient(${color} 0% ${pct}%, var(--color-secondary) ${pct}% 100%)`,
      }}
    >
      <div className="absolute inset-[6px] rounded-full bg-card" />
      <span className="relative font-mono text-[10px] font-bold text-foreground">
        {step.status === 'done' ? (
          <CheckCircle2 className="size-3.5 text-brand-mint" />
        ) : (
          `${Math.round(pct)}%`
        )}
      </span>
    </div>
  );
}

function StepRow({ step }: { step: ReadinessStep }) {
  return (
    <div className="flex items-center gap-3 border-t border-border px-4 py-2.5 first:border-t-0">
      <StepRing step={step} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-foreground">
          {step.label}
        </p>
        <p className="truncate text-[11px] text-muted-foreground">
          {step.description}
        </p>
      </div>
      <span
        className={cn(
          'shrink-0 rounded-full px-2 py-0.5 font-mono text-[10.5px] font-bold',
          BADGE_CLASS[step.status]
        )}
      >
        {stepBadgeLabel(step)}
      </span>
    </div>
  );
}

export function HubReadinessPopover({ readiness }: { readiness: AyReadiness }) {
  const groups = groupStepsForPopover(readiness.steps);
  if (readiness.total === 0) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          Summary
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[420px] p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            Setup readiness · {readiness.complete}/{readiness.total}
          </span>
          <Link
            href="/sis/ay-setup"
            className="text-[12px] font-semibold text-brand-indigo-deep hover:underline"
          >
            Full checklist →
          </Link>
        </div>
        {groups.map((group) => (
          <div key={group.label}>
            <p className="border-t border-border bg-muted/30 px-4 py-1.5 font-mono text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {group.label}
            </p>
            {group.steps.map((step) => (
              <StepRow key={step.id} step={step} />
            ))}
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}
